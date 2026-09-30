# xtts_service.py — la voce XTTS-v2 di CompanionAI, come servizio locale.
#
# Lo avvia il main (xtts-engine.js) con il Python installato al primo uso
# (xtts-setup.js). Carica il modello sulla GPU una volta e risponde su
# 127.0.0.1, a una porta scelta dal sistema, solo a chi conosce il token
# ricevuto nell'ambiente. Quando e' pronto scrive su stdout una riga
# "XTTS_SERVICE_READY {json}"; tutto il resto va su stderr.
#
# /tts risponde a pezzi mentre il modello genera: ogni pezzo e' un intero a
# 32 bit (quanti byte seguono) e i campioni float32 a 24 kHz; un pezzo di 0
# byte chiude la frase. Se il main chiude la connessione (una risposta nuova
# ha interrotto quella vecchia) la generazione si ferma.
#
# XTTS-v2 e' sotto la Coqui Public Model License: solo uso non commerciale.
# Il modello lo scarica l'utente al primo uso, dopo averla accettata.

import json
import os
import struct
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR = sys.argv[1]
SAMPLES_DIR = os.path.realpath(sys.argv[2])
TOKEN = os.environ.get('XTTS_TOKEN', '')
RATE = 24000
MAX_SAMPLE_S = 30
os.environ.setdefault('COQUI_TOS_AGREED', '1')


def log(*args):
    print(*args, file=sys.stderr, flush=True)


# Se il main muore senza chiuderci, stdin si chiude: si esce, liberando la GPU.
# Parte solo a modello caricato: su Windows una lettura di stdin in attesa
# fin dall'avvio bloccava gli import (numpy, torch) e il servizio restava fermo.
def watch_parent():
    try:
        for _ in sys.stdin:
            pass
    finally:
        os._exit(0)


import numpy as np  # noqa: E402
import torch  # noqa: E402
from TTS.tts.configs.xtts_config import XttsConfig  # noqa: E402
from TTS.tts.models.xtts import Xtts  # noqa: E402

started = time.time()
device = 'cuda' if torch.cuda.is_available() else 'cpu'
config = XttsConfig()
config.load_json(os.path.join(MODEL_DIR, 'config.json'))
model = Xtts.init_from_config(config)
model.load_checkpoint(config, checkpoint_dir=MODEL_DIR, use_deepspeed=False)
model.to(device)
model.eval()
lock = threading.Lock()   # una frase alla volta: la GPU e' una
latents = {}


def builtin_speakers():
    manager = getattr(model, 'speaker_manager', None)
    return sorted(manager.speakers.keys()) if manager and getattr(manager, 'speakers', None) else []


def inside_samples(path):
    real = os.path.realpath(path)
    if not real.startswith(SAMPLES_DIR + os.sep):
        raise ValueError('il campione deve stare nella cartella dei campioni')
    return real


def conditioning(speaker):
    """Latenti della voce: una voce inclusa nel modello, o il campione dell'utente."""
    if speaker.get('builtin'):
        s = model.speaker_manager.speakers[speaker['builtin']]
        return s['gpt_cond_latent'].to(device), s['speaker_embedding'].to(device)
    path = inside_samples(speaker['sample'])
    key = (path, os.path.getmtime(path))
    if key not in latents:
        cache = path + '.latents.pt'
        if os.path.exists(cache) and os.path.getmtime(cache) >= os.path.getmtime(path):
            data = torch.load(cache, map_location=device)
        else:
            gpt, emb = model.get_conditioning_latents(audio_path=[path])
            data = {'gpt': gpt, 'emb': emb}
            torch.save(data, cache)
        latents[key] = (data['gpt'].to(device), data['emb'].to(device))
    return latents[key]


def prepare(src, dst):
    """Il campione scelto dall'utente, in WAV mono a 24 kHz, senza silenzi ai bordi, al massimo 30 s."""
    import librosa
    import soundfile as sf
    audio, _ = librosa.load(src, sr=RATE, mono=True)
    audio, _ = librosa.effects.trim(audio, top_db=35)
    audio = audio[: RATE * MAX_SAMPLE_S]
    if len(audio) < RATE * 3:
        raise ValueError('il campione e\' troppo corto: servono almeno 3 secondi di voce')
    peak = float(np.max(np.abs(audio))) or 1.0
    sf.write(inside_samples(dst), (audio / peak * 0.9).astype(np.float32), RATE)
    return len(audio) / RATE


def speak(text, speaker, speed, language):
    gpt, emb = conditioning(speaker)
    return model.inference_stream(text, language, gpt, emb, speed=speed, enable_text_splitting=False)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        if TOKEN and self.headers.get('X-Token') == TOKEN:
            return True
        self.reply(403, {'error': 'token mancante o sbagliato'})
        return False

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(length) or b'{}') if length else {}

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == '/health':
            gpu = torch.cuda.get_device_name(0) if device == 'cuda' else None
            self.reply(200, {'ok': True, 'device': device, 'gpu': gpu,
                             'vram': round(torch.cuda.memory_allocated() / 1e9, 2) if device == 'cuda' else 0})
        elif self.path == '/speakers':
            self.reply(200, {'speakers': builtin_speakers()})
        else:
            self.reply(404, {'error': 'non trovato'})

    def do_POST(self):
        if not self.allowed():
            return
        try:
            data = self.read_json()
            if self.path == '/prepare':
                with lock:
                    seconds = prepare(data['src'], data['dst'])
                    conditioning({'sample': data['dst']})
                self.reply(200, {'ok': True, 'seconds': round(seconds, 1)})
            elif self.path == '/tts':
                self.tts(data)
            else:
                self.reply(404, {'error': 'non trovato'})
        except Exception as error:  # l'errore torna al main, con il dettaglio nel log
            log(traceback.format_exc())
            try:
                self.reply(500, {'error': str(error)})
            except Exception:
                pass

    def tts(self, data):
        text = str(data.get('text') or '').strip()
        if not text:
            self.reply(400, {'error': 'testo vuoto'})
            return
        speed = min(1.4, max(0.7, float(data.get('speed') or 1)))
        with lock:
            chunks = speak(text, data.get('speaker') or {}, speed, data.get('language') or 'it')
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('X-Sample-Rate', str(RATE))
            self.end_headers()
            try:
                for chunk in chunks:
                    pcm = chunk.detach().float().cpu().numpy().astype('<f4').tobytes()
                    self.wfile.write(struct.pack('<I', len(pcm)) + pcm)
                    self.wfile.flush()
                self.wfile.write(struct.pack('<I', 0))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # interrotta dal main: la generazione si ferma qui


# Un giro di prova prima di dirsi pronti: la prima frase vera parte subito.
try:
    names = builtin_speakers()
    if names:
        for _ in speak('Ciao.', {'builtin': names[0]}, 1.0, 'it'):
            pass
except Exception:
    log(traceback.format_exc())

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=watch_parent, daemon=True).start()
print('XTTS_SERVICE_READY ' + json.dumps({
    'port': server.server_address[1], 'device': device, 'seconds': round(time.time() - started, 1),
    'gpu': torch.cuda.get_device_name(0) if device == 'cuda' else None,
}), flush=True)
server.serve_forever()
