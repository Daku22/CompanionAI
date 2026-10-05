// provider-form.js — scelta di provider, modello e chiave API.
//
// La stessa scheda serve alla chat (la prima configurazione, prima di poter
// scrivere) e alle Impostazioni (scheda Modello): qui una volta sola, cosi'
// le due non si separano. La pagina da' il contenitore e il pulsante per
// salvare; il resto (elenco dei modelli dal vivo, errori della chiave) e' qui.
//
// Uso:
//   const form = ProviderForm.mount(contenitore, { api })
//   form.load(config)                 // dalla config pubblica del main
//   const cfg = await form.save()     // config salvata, o null se c'e' un errore

(function () {
  // Una parola sui provider che lo meritano: il resto lo dice il nome.
  const TAGS = { openrouter: 'gratis', ollama: 'sul PC' }

  // Markup fisso: nessun testo da fuori passa da innerHTML.
  const TEMPLATE = `
    <div class="pf-section">
      <div class="pf-label" id="pf-provider-label">Provider</div>
      <div class="pf-grid" role="radiogroup" aria-labelledby="pf-provider-label"></div>
    </div>
    <div class="pf-section">
      <label class="pf-label" for="model-select">Modello</label>
      <div class="pf-model"><select class="pf-input" id="model-select"></select></div>
      <div class="pf-note" id="model-note"></div>
      <button class="pf-link" type="button" data-f="model-test">Prova il modello</button>
      <div class="pf-note" data-f="model-test-note" role="status"></div>
    </div>
    <div class="pf-section" data-f="ollama-tools" hidden>
      <div class="pf-label">Ollama</div>
      <div class="pf-row">
        <button class="pf-link" type="button" data-f="ollama-signin">Accedi a Ollama (per i modelli cloud)</button>
      </div>
      <div class="pf-note" data-f="ollama-state" role="status"></div>
      <label class="pf-label" for="ollama-pull-name">Scarica un modello</label>
      <div class="pf-row">
        <input class="pf-input pf-mono" id="ollama-pull-name" type="text" autocomplete="off" spellcheck="false" placeholder="per esempio qwen3 o gpt-oss:20b-cloud">
        <button class="pf-link" type="button" data-f="ollama-pull">Scarica</button>
      </div>
      <div class="pf-note" data-f="ollama-pull-note" role="status"></div>
      <button class="pf-link" type="button" data-f="ollama-page-models">Modelli da scaricare ↗</button>
      <div class="pf-note">I modelli cloud girano sui server di Ollama: serve l'accesso (gratuito, con dei limiti d'uso) e la prima volta vengono preparati da soli.</div>
    </div>
    <div class="pf-section" data-f="key-section">
      <label class="pf-label" for="api-key-input">Chiave API</label>
      <input class="pf-input pf-mono" id="api-key-input" type="password" autocomplete="off" spellcheck="false" aria-describedby="pf-key-error">
      <div class="pf-error" id="pf-key-error" role="alert"></div>
      <div class="pf-note" data-f="key-saved" hidden>Chiave salvata su questo PC. Lascia il campo vuoto per tenerla, scrivine una nuova per cambiarla.</div>
      <div class="pf-note" data-f="key-unreadable" hidden>La chiave salvata per questo provider non si può più leggere su questo PC: è stata cifrata da un'altra installazione. Inseriscila di nuovo.</div>
      <div class="pf-note" data-f="ollama-note" hidden>Ollama non richiede una chiave. Se è spento, l'app lo avvia da sola.</div>
      <button class="pf-link" type="button" data-f="key-help">Come ottengo una chiave? ↗</button>
    </div>`

  function mount(root, { api }) {
    root.innerHTML = TEMPLATE
    const $ = (sel) => root.querySelector(sel)
    const grid = $('.pf-grid')
    const modelWrap = $('.pf-model')
    const modelSelect = $('#model-select')
    const modelNote = $('#model-note')
    const keySection = $('[data-f="key-section"]')
    const keyInput = $('#api-key-input')
    const keyError = $('#pf-key-error')
    const keySaved = $('[data-f="key-saved"]')
    const keyUnreadable = $('[data-f="key-unreadable"]')
    const ollamaNote = $('[data-f="ollama-note"]')
    const keyHelp = $('[data-f="key-help"]')

    let config = {}
    let selectedProvider = 'openrouter'
    let selectedModel = ''
    let keyOddAccepted = ''
    // Modelli per provider: prima l'elenco statico del router, poi quello dal
    // vivo (OpenRouter e Ollama), che arriva dopo e lo sostituisce.
    const liveModels = {}

    function buildGrid() {
      const providers = config.providers || {}
      grid.replaceChildren(...Object.entries(providers).map(([id, p]) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'pf-provider'
        btn.setAttribute('role', 'radio')
        btn.dataset.provider = id
        const radio = document.createElement('span')
        radio.className = 'pf-radio'
        radio.setAttribute('aria-hidden', 'true')
        btn.append(radio, p.name)
        if (TAGS[id]) {
          const tag = document.createElement('span')
          tag.className = 'pf-tag'
          tag.textContent = TAGS[id]
          btn.append(tag)
        }
        btn.addEventListener('click', () => selectProvider(id))
        return btn
      }))
      markSelected()
    }

    function markSelected() {
      for (const b of grid.children) {
        const on = b.dataset.provider === selectedProvider
        b.setAttribute('aria-checked', on ? 'true' : 'false')
        b.tabIndex = on ? 0 : -1
      }
    }

    // Frecce tra i provider, come in un gruppo di pulsanti di scelta.
    grid.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
      if (!step) return
      e.preventDefault()
      const ids = [...grid.children].map(b => b.dataset.provider)
      const next = ids[(ids.indexOf(selectedProvider) + step + ids.length) % ids.length]
      selectProvider(next)
      grid.querySelector(`[data-provider="${next}"]`).focus()
    })

    function selectProvider(id) {
      selectedProvider = id
      markSelected()
      updateModelSelect()
      updateKeyField()
    }

    function fillModelSelect(models) {
      // Opzioni costruite con textContent: nomi e id dei modelli di OpenRouter
      // arrivano dalla rete, e con innerHTML potrebbero iniettare markup.
      const list = [...models]
      if (selectedModel && !list.some(m => m.id === selectedModel) && selectedProvider === config.provider) {
        list.unshift({ id: selectedModel, label: selectedModel + ' (attuale)' })
      }
      const option = (m) => {
        const o = document.createElement('option')
        o.value = m.id
        o.textContent = m.label
        o.selected = m.id === selectedModel
        return o
      }
      // Gruppi (Blocco 7a): OpenRouter gratuiti / a pagamento, Ollama installati / cloud.
      const groups = [...new Set(list.map(m => m.group).filter(Boolean))]
      if (groups.length) {
        const group = (label) => { const g = document.createElement('optgroup'); g.label = label; g.append(...list.filter(m => (m.group || groups[0]) === label).map(option)); return g }
        modelSelect.replaceChildren(...groups.map(group))
      } else modelSelect.replaceChildren(...list.map(option))
      if (list.length) selectedModel = modelSelect.value
    }

    function updateModelSelect() {
      const provider = selectedProvider
      fillModelSelect(liveModels[provider] || config.providers?.[provider]?.models || [])
      const asking = !liveModels[provider]
      modelWrap.setAttribute('aria-busy', asking ? 'true' : 'false')
      modelNote.textContent = asking ? (provider === 'ollama' ? 'Cerco i modelli installati…' : 'Aggiorno l\'elenco dei modelli…') : ''
      api.listModels(provider).then(({ models, live, source }) => {
        if (selectedProvider !== provider) return
        modelWrap.setAttribute('aria-busy', 'false')
        if (live) {
          liveModels[provider] = models
          fillModelSelect(models)
          root.dispatchEvent(new CustomEvent('models'))
          modelNote.textContent = provider === 'ollama' ? 'Modelli installati su questo PC e modelli cloud.'
            : source === 'openrouter' ? 'Elenco aggiornato dal catalogo di OpenRouter: con la tua chiave salvata compare quello ufficiale.' : 'Elenco aggiornato.'
        } else {
          modelNote.textContent = provider === 'ollama' ? 'Ollama non risponde: elenco di esempio.'
            : provider === 'claude' || provider === 'openai' ? 'Elenco di esempio: con la chiave salvata compare quello vero.' : ''
        }
      }).catch(() => {
        if (selectedProvider !== provider) return
        modelWrap.setAttribute('aria-busy', 'false')
        modelNote.textContent = ''
      })
    }
    modelSelect.addEventListener('change', () => { selectedModel = modelSelect.value })

    function showKeyError(text) {
      keyError.textContent = text
      keyInput.setAttribute('aria-invalid', text ? 'true' : 'false')
    }
    keyInput.addEventListener('input', () => { if (keyError.textContent) showKeyError('') })

    function updateKeyField() {
      const p = (config.providers || {})[selectedProvider]
      const ollama = selectedProvider === 'ollama'
      showKeyError('')
      keyOddAccepted = ''
      keySection.classList.toggle('pf-off', ollama)
      keyInput.disabled = ollama
      keyInput.value = ''
      ollamaNote.hidden = !ollama
      ollamaTools.hidden = !ollama
      keyHelp.textContent = ollama ? 'Scarica Ollama ↗' : 'Come ottengo una chiave? ↗'
      // Le chiavi non tornano mai dal main process: campo vuoto significa
      // "mantieni la chiave gia' salvata", non "cancella la configurazione".
      keyInput.placeholder = ollama ? 'Non richiesta'
        : config.keyConfigured?.[selectedProvider] ? '•••••••• chiave salvata' : (p?.keyPlaceholder || 'Incolla qui la chiave')
      keySaved.hidden = ollama || !config.keyConfigured?.[selectedProvider]
      // Chiave salvata ma illeggibile: senza questa nota la configurazione
      // ricompariva senza spiegazione, come se la chiave fosse sparita.
      keyUnreadable.hidden = ollama || !config.keyUnreadable?.[selectedProvider]
    }

    // La pagina della chiave la apre il main: qui si indica solo il provider.
    keyHelp.addEventListener('click', () => { api.openKeyPage(selectedProvider).catch(() => {}) })

    // Ollama (Blocco 7a): accesso per il cloud, download con avanzamento. Se e'
    // spento lo avvia il main da solo, quando serve.
    const ollamaTools = $('[data-f="ollama-tools"]')
    const ollamaState = $('[data-f="ollama-state"]')
    const pullName = $('#ollama-pull-name')
    const pullNote = $('[data-f="ollama-pull-note"]')
    const refreshOllama = () => { delete liveModels.ollama; if (selectedProvider === 'ollama') updateModelSelect() }
    $('[data-f="ollama-signin"]').addEventListener('click', async () => {
      ollamaState.textContent = 'Apro la pagina di accesso…'
      const r = await api.ollamaSignin().catch(e => ({ ok: false, error: e.message }))
      ollamaState.textContent = !r.ok ? '✗ ' + r.error
        : r.already ? '✓ Hai gia\' fatto l\'accesso: i modelli cloud sono pronti.'
        : 'Conferma l\'accesso nella pagina di ollama.com che si e\' aperta nel browser, poi torna qui.'
    })
    $('[data-f="ollama-pull"]').addEventListener('click', async (e) => {
      const name = pullName.value.trim()
      if (!name) { pullName.focus(); return }
      const btn = e.currentTarget
      btn.disabled = true
      pullNote.textContent = 'Scarico ' + name + '…'
      const off = api.onOllamaPullProgress((p) => {
        pullNote.textContent = name + ': ' + (p.status || '…') + (p.percent != null ? ' ' + p.percent + '%' : '')
      })
      const r = await api.ollamaPull(name).catch(err => ({ ok: false, error: err.message }))
      off()
      btn.disabled = false
      pullNote.textContent = r.ok ? '✓ ' + name + ' scaricato: lo trovi nell\'elenco dei modelli.' : '✗ ' + r.error
      if (r.ok) { refreshOllama(); selectedModel = name.replace(/:latest$/, '') }
    })
    $('[data-f="ollama-page-models"]').addEventListener('click', () => api.ollamaOpenPage('models'))

    // Prova il modello (Blocco 7a): una richiesta vera, con la chiave scritta
    // nel campo o quella salvata, prima di salvare.
    const testBtn = $('[data-f="model-test"]')
    const testNote = $('[data-f="model-test-note"]')
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true
      testNote.textContent = 'Provo ' + (modelSelect.value || 'il modello') + '…'
      const r = await api.testModel({ provider: selectedProvider, model: modelSelect.value, key: keyInput.value.trim() }).catch(e => ({ ok: false, error: e.message }))
      testNote.textContent = r && r.ok
        ? '✓ Funziona: ha risposto in ' + (r.ms / 1000).toFixed(1).replace('.', ',') + ' s' +
          (r.format ? ', nel formato del companion.' : ', ma non nel formato del companion: le animazioni potrebbero non partire.') +
          (r.vision ? ' Vede anche le immagini.' : '')
        : '✗ Non funziona: ' + ((r && r.error) || 'errore sconosciuto')
      testBtn.disabled = false
    })
    modelSelect.addEventListener('change', () => { testNote.textContent = '' })

    return {
      get provider() { return selectedProvider },
      get keyInput() { return keyInput },

      /** Il nome leggibile di un modello, anche dall'elenco dal vivo. */
      labelOf(provider, id) {
        const m = (liveModels[provider] || config.providers?.[provider]?.models || []).find(x => x.id === id)
        return m ? m.label : ''
      },

      /** Mostra la config del main: provider e modello in uso. */
      load(cfg) {
        config = cfg || {}
        selectedProvider = config.provider || 'openrouter'
        // Nessun id di modello codificato qui: la lista arriva dal router via
        // config, cosi' la UI non puo' proporre un modello che il backend non conosce.
        selectedModel = config.model || config.providers?.[selectedProvider]?.models?.[0]?.id || ''
        buildGrid()
        updateModelSelect()
        updateKeyField()
      },

      /** Valida e salva. Errori della chiave sotto il campo, non in un
       *  confirm(): "salva comunque" e' un secondo clic su Salva. */
      async save() {
        selectedModel = modelSelect.value
        const key = keyInput.value.trim()
        const p = (config.providers || {})[selectedProvider]
        const name = p?.name || selectedProvider

        if (selectedProvider !== 'ollama' && !key && !config.keyConfigured?.[selectedProvider]) {
          showKeyError('Incolla la chiave di ' + name + ' per usarlo.')
          keyInput.focus()
          return null
        }
        if (key && p?.keyPrefix && !key.startsWith(p.keyPrefix) && keyOddAccepted !== key) {
          showKeyError('Le chiavi di ' + name + ' di solito iniziano con «' + p.keyPrefix + '». Controllala, oppure salva di nuovo per tenerla così.')
          keyOddAccepted = key
          keyInput.focus()
          return null
        }
        keyOddAccepted = ''
        showKeyError('')

        const keys = {}
        if (selectedProvider !== 'ollama' && key) keys[selectedProvider] = key
        try {
          const saved = await api.setConfig({ provider: selectedProvider, model: selectedModel, keys })
          this.load(saved)
          return saved
        } catch (e) {
          showKeyError('Salvataggio non riuscito: ' + (e && e.message || e))
          return null
        }
      },
    }
  }

  window.ProviderForm = { mount }
})()
