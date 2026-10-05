// connectors.js — il catalogo dei connettori (Blocco 7f): server MCP remoti
// ufficiali dei servizi piu' usati, provati il 5 ottobre 2026.
//   auth 'none':  funzionano subito, senza account;
//   auth 'oauth': "Collega" apre l'accesso al servizio nel browser (registrazione
//                 automatica dell'app, verificata su ciascuno);
//   auth 'token': serve un token personale, da creare sul sito del servizio.
// Fuori dal catalogo, apposta, quelli che muovono soldi (PayPal, Square, Stripe),
// e quelli che non accettano app nuove (Figma: registrazione rifiutata, 403).
// Si possono sempre provare come connettore personalizzato.

const CONNECTORS = [
  // Pronti subito, senza account
  { id: 'exa', name: 'Exa', auth: 'none', url: 'https://mcp.exa.ai/mcp',
    description: 'Cerca sul web e legge le pagine: notizie, articoli, risposte aggiornate.' },
  { id: 'huggingface', name: 'Hugging Face', auth: 'none', url: 'https://huggingface.co/mcp',
    description: 'Cerca modelli, dataset e demo di intelligenza artificiale.' },
  { id: 'microsoft-learn', name: 'Microsoft Learn', auth: 'none', url: 'https://learn.microsoft.com/api/mcp',
    description: 'La documentazione ufficiale Microsoft: Windows, Office, Azure, .NET.' },
  { id: 'context7', name: 'Context7', auth: 'none', url: 'https://mcp.context7.com/mcp',
    description: 'Documentazione aggiornata di librerie e linguaggi di programmazione.' },
  { id: 'deepwiki', name: 'DeepWiki', auth: 'none', url: 'https://mcp.deepwiki.com/mcp',
    description: 'Spiega com\'è fatto un progetto open source pubblicato su GitHub.' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', auth: 'none', url: 'https://docs.mcp.cloudflare.com/mcp',
    description: 'La documentazione di Cloudflare.' },

  // Con il tuo account
  { id: 'notion', name: 'Notion', auth: 'oauth', url: 'https://mcp.notion.com/mcp',
    description: 'Cerca, legge e aggiorna le tue pagine e i tuoi database.' },
  { id: 'todoist', name: 'Todoist', auth: 'oauth', url: 'https://ai.todoist.net/mcp',
    description: 'Le tue attività: leggerle, aggiungerne, completarle.' },
  { id: 'linear', name: 'Linear', auth: 'oauth', url: 'https://mcp.linear.app/mcp',
    description: 'Le tue issue e i tuoi progetti.' },
  { id: 'atlassian', name: 'Jira e Confluence', auth: 'oauth', url: 'https://mcp.atlassian.com/v1/mcp',
    description: 'I ticket di Jira e le pagine di Confluence (Atlassian).' },
  { id: 'airtable', name: 'Airtable', auth: 'oauth', url: 'https://mcp.airtable.com/mcp',
    description: 'Le tue basi, tabelle e record.' },
  { id: 'monday', name: 'monday.com', auth: 'oauth', url: 'https://mcp.monday.com/mcp',
    description: 'Bacheche, elementi e aggiornamenti.' },
  { id: 'canva', name: 'Canva', auth: 'oauth', url: 'https://mcp.canva.com/mcp',
    description: 'Cerca e crea i tuoi design.' },
  { id: 'zapier', name: 'Zapier', auth: 'oauth', url: 'https://mcp.zapier.com/api/mcp/mcp',
    description: 'Le azioni che scegli su Zapier, verso migliaia di altre app.' },
  { id: 'sentry', name: 'Sentry', auth: 'oauth', url: 'https://mcp.sentry.dev/mcp',
    description: 'Errori e problemi delle tue applicazioni.' },
  { id: 'vercel', name: 'Vercel', auth: 'oauth', url: 'https://mcp.vercel.com',
    description: 'I tuoi progetti e i deploy.' },
  { id: 'netlify', name: 'Netlify', auth: 'oauth', url: 'https://netlify-mcp.netlify.app/mcp',
    description: 'I tuoi siti e i deploy.' },
  { id: 'webflow', name: 'Webflow', auth: 'oauth', url: 'https://mcp.webflow.com/mcp',
    description: 'I tuoi siti e i contenuti del CMS.' },
  { id: 'wix', name: 'Wix', auth: 'oauth', url: 'https://mcp.wix.com/mcp',
    description: 'Il tuo sito Wix: pagine, prodotti, prenotazioni.' },
  { id: 'github', name: 'GitHub', auth: 'token', url: 'https://api.githubcopilot.com/mcp/',
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
    tokenHelp: 'GitHub vuole un token personale: crealo sul sito (si apre la pagina), poi incollalo qui.',
    description: 'Repository, issue e pull request.' },
]

/** Il catalogo per la pagina, con il connettore gia' aggiunto segnato. */
function catalog(servers) {
  return CONNECTORS.map(c => ({ ...c, added: (servers || []).some(s => s.url === c.url) }))
}

module.exports = { CONNECTORS, catalog }
