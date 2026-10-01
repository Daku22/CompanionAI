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
    </div>
    <div class="pf-section" data-f="key-section">
      <label class="pf-label" for="api-key-input">Chiave API</label>
      <input class="pf-input pf-mono" id="api-key-input" type="password" autocomplete="off" spellcheck="false" aria-describedby="pf-key-error">
      <div class="pf-error" id="pf-key-error" role="alert"></div>
      <div class="pf-note" data-f="key-saved" hidden>Chiave salvata su questo PC. Lascia il campo vuoto per tenerla, scrivine una nuova per cambiarla.</div>
      <div class="pf-note" data-f="key-unreadable" hidden>La chiave salvata per questo provider non si può più leggere su questo PC: è stata cifrata da un'altra installazione. Inseriscila di nuovo.</div>
      <div class="pf-note" data-f="ollama-note" hidden>Ollama non richiede una chiave. Avvia il server con <code>ollama serve</code> prima di usarlo.</div>
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
      modelSelect.replaceChildren(...list.map(m => {
        const option = document.createElement('option')
        option.value = m.id
        option.textContent = m.label
        option.selected = m.id === selectedModel
        return option
      }))
      if (list.length) selectedModel = modelSelect.value
    }

    function updateModelSelect() {
      const provider = selectedProvider
      fillModelSelect(liveModels[provider] || config.providers?.[provider]?.models || [])
      const asking = !liveModels[provider] && (provider === 'openrouter' || provider === 'ollama')
      modelWrap.setAttribute('aria-busy', asking ? 'true' : 'false')
      modelNote.textContent = asking ? (provider === 'ollama' ? 'Cerco i modelli installati…' : 'Aggiorno l\'elenco dei modelli gratuiti…') : ''
      api.listModels(provider).then(({ models, live }) => {
        if (selectedProvider !== provider) return
        modelWrap.setAttribute('aria-busy', 'false')
        if (live) {
          liveModels[provider] = models
          fillModelSelect(models)
          root.dispatchEvent(new CustomEvent('models'))
          modelNote.textContent = provider === 'ollama' ? 'Modelli installati su questo PC.' : 'Elenco aggiornato dei modelli gratuiti.'
        } else {
          modelNote.textContent = provider === 'ollama' ? 'Ollama non risponde: elenco di esempio.' : ''
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
