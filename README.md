# C.S.I. · Ricalcolo pensione — clone statico

Clone funzionante dell'app **Base44** `finicky-smart-pension-flow` (C.S.I. — Centro Servizi Integrati): landing di acquisizione + procedura di prenotazione in tre passaggi + area riservata.

Nessun backend: tutti i dati vivono nel browser (`localStorage`), così il clone gira anche aprendo i file in locale.

---

## Struttura

```
csi-pensioni/
├── index.html              Landing: hero, card SPID, immagine, i tre passaggi
├── prenota.html            Procedura in 3 passaggi + schermata di conferma
├── login.html              Accesso area riservata (stile Base44) + elenco prenotazioni
└── assets/
    ├── css/theme.css       Design system (token, componenti, calendario, form)
    └── js/app.js           Store locale, wizard, calendario, .ics, login
```

## Flusso di prenotazione

1. **Anagrafica** — nome e cognome, codice fiscale (16 caratteri, convertito in maiuscolo), numero e validità del documento, email, telefono, immagini facoltative di CF e carta d'identità (viene registrato solo il nome del file). Il pulsante *Continua* resta disabilitato finché i campi non sono validi.
2. **Mandato e privacy** — due consensi obbligatori nel riquadro bianco, poi la scelta obbligatoria sullo SPID: *Ho già lo SPID* oppure *Non ce l'ho: voglio l'assistenza della struttura*. La seconda opzione apre il pannello con condizioni, costo indicativo di 35 € e i marchi degli enti di certificazione.
3. **Calendario** — mese italiano con lunedì come primo giorno, giorni passati e domeniche disabilitati, selezione fino a 90 giorni; quattro orari (09:00, 11:00, 14:00, 16:00) con gli slot già trascorsi non selezionabili; riepilogo aggiornato in tempo reale.

Confermando si ottiene la ricevuta con codice `CSI-AAAA-NNNN` e il pulsante **Aggiungi al calendario**, che genera al volo un file `.ics` (evento di 45 minuti, fuso `Europe/Rome`).

## Accesso

- `login.html` riproduce la schermata di autenticazione servita dall'app originale (Google + email/password).
- È un accesso dimostrativo: qualsiasi email valida e una password di almeno 6 caratteri aprono l'area riservata con l'elenco delle prenotazioni salvate su quel browser. Nessun dato esce dal dispositivo.
- Dopo l'accesso compaiono le prenotazioni locali con stato e codice; *Esci* chiude la sessione.

## Asset grafici

Le immagini sono referenziate dalla cartella degli allegati del progetto (`.zwork/attachments/…`), così il clone resta identico all'originale senza duplicare binari:

| Uso | File |
|---|---|
| Hero della landing | `heri image pensionato felice.jpg` |
| Marchio Namirial ID | `namirial.jpg` |
| Marchio SpidItalia | `spiditalia.png` |
| Marchio InfoCert ID | `InfoCert-ID.png` |
| Banner SPID/Cie ID (passo 2) | `CSI - SPID.jpg` |

**Per pubblicare** basta copiare questi file in `csi-pensioni/assets/img/` con i nomi `hero.jpg`, `namirial.jpg`, `spiditalia.png`, `infocert.png`, `spid-cie.jpg`: i percorsi `../.zwork/attachments/...` restano validi in locale e, se non risolvono, il codice ripiega automaticamente su `assets/img/...`. Se i file non ci sono proprio:

- la foto della landing passa alla CDN Base44 e infine a un blocco grafico con l'emblema;
- i tre marchi mostrano un segnaposto tipografico (nome dell'ente + SPID);
- il banner SPID/Cie ID diventa una fascia sfumata con la scritta «spid · Cie ID».

Nessuna modifica all'HTML è necessaria in nessuno dei due casi.

## Dati e reset

| Cosa | Chiave |
|---|---|
| Prenotazioni | `localStorage` → `csi.bookings.v1` |
| Sessione | `localStorage` → `csi.session.v1` |
| Bozza del wizard | `sessionStorage` → `csi.draft.v1` |

Reset completo: aprire una pagina qualsiasi con `?reset=1` (es. `index.html?reset=1`).

## Avvio locale

```bash
python -m http.server 8080
# http://localhost:8080/csi-pensioni/
```

Funziona anche con doppio clic su `index.html`: in quel caso il browser può bloccare i font remoti e l'immagine di copertina, che hanno un fallback grafico già previsto.

## Pubblicazione

È un sito statico: basta caricare la cartella `csi-pensioni/` su Vercel, Netlify o Cloudflare Pages. Senza i cinque file immagine il sito funziona comunque, con i segnaposto descritti sopra.

```bash
vercel deploy --prod      # dalla cartella csi-pensioni/
netlify deploy --prod --dir .
```

## Differenze dall'originale

| Aspetto | Originale (Base44) | Clone |
|---|---|---|
| Backend | entità Base44 + auth di piattaforma | nessuno: `localStorage` |
| Invio email / invito calendario | automatico lato server | file `.ics` generato nel browser |
| Immagine di copertina | asset su CDN Base44 | stesso scatto, referenziato dagli allegati del progetto (fallback su CDN) |
| Marchi SPID | immagini degli enti | le stesse immagini fornite dal cliente |
| Schermata di conferma | non raggiungibile nell'originale (limite crediti) | ricostruita su modello del riepilogo |
| Area riservata | solo login di piattaforma | login + elenco prenotazioni locale |

## Design

| Ruolo | Token | Valore |
|---|---|---|
| Sfondo carta | `--bg` | `#F8F3EB` |
| Superfici | `--surface`, `--surface-2` | `#FFFFFF`, `#EFE8DC` |
| Bordo | `--border` | `#E6DECF` |
| Testo strutturale | `--fg` | `#0F2340` |
| Testo corrente | `--body` | `#4B5566` |
| Primario (bottoni, selezione) | `--primary` | `#0C2340` |
| Carattere | `--font` | Inter (fallback sistema) |

Angoli: input 8 px, card 16 px, bottoni a pillola. Titoli con tracking negativo (-0.028em), corpo 16–19 px.
