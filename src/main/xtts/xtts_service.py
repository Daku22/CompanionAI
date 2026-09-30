# xtts_service.py — la voce locale di CompanionAI, come servizio: XTTS-v2 per
# parlare e faster-whisper per ascoltare il microfono.
#
# Lo avvia il main (xtts-engine.js) con il Python installato al primo uso
# (xtts-setup.js). Risponde su 127.0.0.1, a una porta scelta dal sistema, solo
# a chi conosce il token ricevuto nell'ambiente. Carica sulla GPU i modelli
# chiesti in VOICE_LOAD ("tts", "stt" o tutti e due), gli altri alla prima
# richiesta o con /load. Quando e' pronto scrive su stdout una riga
# "XTTS_SERVICE_READY {json}"; tutto il resto va su stderr. Si chiude da solo
# quando finisce l'app (VOICE_PARENT_PID) o il suo lanciatore.
#
# /tts risponde a pezzi mentre il modello genera: ogni pezzo e' un intero a
# 32 bit (quanti byte seguono) e i campioni float32 a 24 kHz; un pezzo di 0
# byte chiude la frase. Se il main chiude la connessione (una risposta nuova
# ha interrotto quella vecchia) la generazione si ferma.
#
# /stt riceve i campioni float32 a 16 kHz, mono, e risponde con il testo.
#
# XTTS-v2 e' sotto la Coqui Public Model License: solo uso non commerciale.
# Il modello lo scarica l'utente al primo uso, dopo averla accettata.
# Whisper large-v3-turbo (OpenAI, convertito per CTranslate2): MIT.

import importlib
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
WHISPER_DIR = sys.argv[3] if len(sys.argv) > 3 else ''
TOKEN = os.environ.get('XTTS_TOKEN', '')
LOAD = [k for k in os.environ.get('VOICE_LOAD', 'tts').split(',') if k in ('tts', 'stt')]
RATE = 24000
STT_RATE = 16000
MAX_SAMPLE_S = 30
MAX_LISTEN_S = 120
os.environ.setdefault('COQUI_TOS_AGREED', '1')


def log(*args):
    print(*args, file=sys.stderr, flush=True)


# Se l'app muore, o il main chiude il lanciatore del venv (stop()), si esce
# liberando la GPU. Si aspetta la fine dei due processi con
# WaitForMultipleObjects, non leggendo stdin: una lettura di stdin in attesa
# tiene un lock della libreria C di Windows, e un import fatto intanto (XTTS,
# con scipy e i suoi DLL) si bloccava nel caricatore dei DLL; da li' il server
# non riusciva piu' ad aprire thread e ogni richiesta restava appesa.
def watch_parent():
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL('kernel32')
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    k32.WaitForMultipleObjects.argtypes = (wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE), wintypes.BOOL, wintypes.DWORD)
    synchronize, infinite = 0x00100000, 0xFFFFFFFF
    pids = {os.getppid(), int(os.environ.get('VOICE_PARENT_PID') or 0)} - {0}
    handles = [h for h in (k32.OpenProcess(synchronize, False, pid) for pid in pids) if h]
    if not handles:
        log('processi da guardare non trovati: il servizio non si chiudera\' da solo')
        return
    k32.WaitForMultipleObjects(len(handles), (wintypes.HANDLE * len(handles))(*handles), False, infinite)
    os._exit(0)


if os.name == 'nt':
    threading.Thread(target=watch_parent, daemon=True).start()


# torch per primo: carica le DLL di CUDA (cuBLAS, cuDNN) che servono anche a
# CTranslate2, il motore di faster-whisper.
import numpy as np  # noqa: E402
import torch  # noqa: E402

started = time.time()
device = 'cuda' if torch.cuda.is_available() else 'cpu'
tts_lock = threading.Lock()   # una frase alla volta: la GPU e' una
stt_lock = threading.Lock()   # un ascolto alla volta
tts_model = None
stt_model = None
latents = {}


def get_tts():
    """XTTS, caricato la prima volta (da chiamare con tts_lock preso)."""
    global tts_model
    if tts_model is None:
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts
        config = XttsConfig()
        config.load_json(os.path.join(MODEL_DIR, 'config.json'))
        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=MODEL_DIR, use_deepspeed=False)
        model.to(device)
        model.eval()
        tts_model = model
        # Un giro di prova: la prima frase vera parte subito.
        try:
            names = builtin_speakers()
            if names:
                for _ in speak('Ciao.', {'builtin': names[0]}, 1.0, 'it'):
                    pass
        except Exception:
            log(traceback.format_exc())
    return tts_model


def get_stt():
    """faster-whisper, caricato la prima volta (da chiamare con stt_lock preso)."""
    global stt_model
    if stt_model is None:
        if not WHISPER_DIR or not os.path.exists(os.path.join(WHISPER_DIR, 'model.bin')):
            raise ValueError('il modello del microfono non e\' installato')
        # I pacchetti del microfono possono essere arrivati con il servizio
        # gia' acceso: Python deve rileggere le cartelle.
        importlib.invalidate_caches()
        from faster_whisper import WhisperModel
        model = WhisperModel(WHISPER_DIR, device=device, compute_type='float16' if device == 'cuda' else 'int8')
        # Il primo ascolto prepara la GPU (qualche secondo): lo si fa adesso.
        list(model.transcribe(np.zeros(STT_RATE, np.float32), language='it', without_timestamps=True)[0])
        stt_model = model
    return stt_model


def load(kind):
    if kind == 'tts':
        with tts_lock:
            get_tts()
    elif kind == 'stt':
        with stt_lock:
            get_stt()
    else:
        raise ValueError('modello sconosciuto: ' + str(kind))


def loaded():
    return [k for k, m in (('tts', tts_model), ('stt', stt_model)) if m is not None]


def builtin_speakers():
    manager = getattr(tts_model, 'speaker_manager', None)
    return sorted(manager.speakers.keys()) if manager and getattr(manager, 'speakers', None) else []


def inside_samples(path):
    real = os.path.realpath(path)
    if not real.startswith(SAMPLES_DIR + os.sep):
        raise ValueError('il campione deve stare nella cartella dei campioni')
    return real


def conditioning(speaker):
    """Latenti della voce: una voce inclusa nel modello, o il campione dell'utente."""
    model = get_tts()
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
    return get_tts().inference_stream(text, language, gpt, emb, speed=speed, enable_text_splitting=False)


def transcribe(audio, language):
    """Il testo detto nel microfono. Il filtro VAD toglie i silenzi: senza,
    Whisper sul silenzio si inventa frasi ("Sottotitoli a cura di...")."""
    with stt_lock:
        segments, _ = get_stt().transcribe(audio, language=language, vad_filter=True, beam_size=5,
                                           condition_on_previous_text=False, without_timestamps=True)
        return ' '.join(s.text.strip() for s in segments).strip()


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

    def read_body(self, limit):
        length = int(self.headers.get('Content-Length') or 0)
        if length > limit:
            raise ValueError('richiesta troppo grande')
        return self.rfile.read(length) if length else b''

    def read_json(self):
        body = self.read_body(1 << 20)
        return json.loads(body) if body else {}

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == '/health':
            gpu = torch.cuda.get_device_name(0) if device == 'cuda' else None
            self.reply(200, {'ok': True, 'device': device, 'gpu': gpu, 'loaded': loaded(),
                             'vram': round(torch.cuda.memory_allocated() / 1e9, 2) if device == 'cuda' else 0})
        elif self.path == '/speakers':
            with tts_lock:
                get_tts()
            self.reply(200, {'speakers': builtin_speakers()})
        else:
            self.reply(404, {'error': 'non trovato'})

    def do_POST(self):
        if not self.allowed():
            return
        try:
            if self.path == '/stt':
                self.stt()
                return
            data = self.read_json()
            if self.path == '/prepare':
                with tts_lock:
                    seconds = prepare(data['src'], data['dst'])
                    conditioning({'sample': data['dst']})
                self.reply(200, {'ok': True, 'seconds': round(seconds, 1)})
            elif self.path == '/load':
                load(data.get('kind'))
                self.reply(200, {'ok': True, 'loaded': loaded()})
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

    def stt(self):
        if self.headers.get('X-Sample-Rate') != str(STT_RATE):
            self.reply(400, {'error': 'servono campioni a 16 kHz'})
            return
        body = self.read_body(STT_RATE * 4 * MAX_LISTEN_S)
        if len(body) % 4:
            self.reply(400, {'error': 'campioni non validi'})
            return
        audio = np.frombuffer(body, dtype='<f4').astype(np.float32)
        took = time.time()
        text = transcribe(audio, self.headers.get('X-Language') or 'it') if len(audio) else ''
        self.reply(200, {'text': text, 'seconds': round(len(audio) / STT_RATE, 2), 'took': round(time.time() - took, 2)})

    def tts(self, data):
        text = str(data.get('text') or '').strip()
        if not text:
            self.reply(400, {'error': 'testo vuoto'})
            return
        speed = min(1.4, max(0.7, float(data.get('speed') or 1)))
        with tts_lock:
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


# I modelli chiesti all'avvio. Se XTTS non si carica il servizio non serve:
# l'errore esce con lui. Whisper che non si carica resta un errore di /stt.
for kind in LOAD:
    try:
        load(kind)
    except Exception:
        log(traceback.format_exc())
        if kind == 'tts':
            raise

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print('XTTS_SERVICE_READY ' + json.dumps({
    'port': server.server_address[1], 'device': device, 'seconds': round(time.time() - started, 1),
    'gpu': torch.cuda.get_device_name(0) if device == 'cuda' else None, 'loaded': loaded(),
}), flush=True)
server.serve_forever()
