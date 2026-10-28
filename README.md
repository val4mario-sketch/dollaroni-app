# Dollaroni – SuMoth Dollars per il Sapienza Foiling Team

App per calcolare i SuMoth Dollars (SM$) della barca e produrre in automatico i file
nel formato richiesto dalla SuMoth Challenge. Si lavora in una vista interna comoda; quando
serve, un tasto riempie i template ufficiali.

**Versione 0.5.0 (fase 5).** Ci sono il motore di calcolo, i dati 2026, l'interfaccia, "Esporta S1", il passaggio S1→S2 con confronto ed "Esporta S2",
le **regole 2027**, **Brumoth**, l'assistente con IA locale (la barchetta in basso a destra) e gli **avvisi di aggiornamento** per tutti i PC.
Mancano ancora il listino 2027 (sta su SuMoth Agora), il salvataggio su Google Drive e la creazione del repository GitHub.

## Come si usa

1. Doppio clic su **`Avvia Dollaroni.bat`**: si apre il browser su http://127.0.0.1:8765/. Serve Python; chiudi la finestra nera per spegnere.
2. Nella schermata iniziale scegli una di queste strade:
   - **Nuova barca 2027**: parti da zero.
   - **Nuova barca partendo da Meravijosa S1 2026**: stessi pezzi e voci, da aggiornare.
   - Apri un file `.dollaroni.json`, oppure guarda gli esempi 2026.
3. Le sezioni a sinistra:
   - **Panoramica**: dove vanno i dollari, limiti di carbonio della Tab. 2, masse del §2.5, cose da sistemare.
   - **Pezzi laminati**: un pezzo corrisponde a un foglio del Layup Calculator.
     - Per ogni substack scegli fibra, matrice, processo, area, numero di ply e grammatura, con la provenienza (scaduto −50%, eccedenza −25%, upcycled).
     - Masse e costi si calcolano mentre scrivi.
     - C'è l'anteprima di come uscirà il foglio ufficiale.
   - **Voci di costo**: tutto il resto (stampi, consumabili, lavorazioni a ore, hardware MSRP, parti usate della Tab. 3, elementi upcycled), diviso nelle 7 categorie del template S2. Le righe grigie arrivano in automatico dai pezzi.
   - **Controlli**: errori e cose da verificare, con il tasto "Vai" per arrivare al punto da correggere.
   - **Listino**: il listino ufficiale 2026 e le voci aggiunte dal team (MSRP, prezzi dati su Discord, sempre con la fonte).
   - **Esporta S1**: un clic produce tre cose, scaricabili una per una o tutte in uno zip:
     - il Layup Calculator ufficiale compilato, un file per pezzo;
     - le immagini delle tabelle per l'appendice;
     - un documento Word/Google Docs con tutte le tabelle.

     Ogni tabella ha anche il tasto "Copia per Google Docs".
4. **Salva** (Ctrl+S) scrive il file progetto. Nel frattempo una copia viene comunque salvata in automatico nel browser.
5. Ctrl+Z / Ctrl+Y annullano e ripetono qualsiasi modifica.

## Brumoth, l'assistente con IA locale

In basso a destra c'è una **barchetta** (un Moth sui foil): è **Brumoth**. Entrando nell'app compare il fumetto
"Chiedi a Brumoth!", che sparisce appena si scorre la pagina o si tocca da un'altra parte (cliccandolo si apre la chat).
La chat risponde sul progetto aperto. Esempi:
"quanto budget ci rimane?", "quanto carbonio serve per finire il budget?", "dove c'è troppo carbonio?",
"fammi la classifica dei costi", "e se facessi la deriva in basalto?", "e se aggiungo 2 kg di carbonio nello scafo?",
"come possiamo risparmiare?", "cosa dobbiamo sistemare?", "cosa dice il regolamento sugli sconti?", "cosa è cambiato rispetto all'S1?".

**Due modalità**, scelte dal menu a tendina sotto la casella della chat (come la scelta del modello nelle app di IA):
- **Istantaneo** (predefinita): risponde il motore di Dollaroni con i numeri calcolati, **subito** e sempre esatti;
- **Completo**: dopo la risposta dai dati, l'IA locale la riscrive a parole sue. Ci mette il tempo che serve
  (da mezzo minuto a qualche minuto sui portatili); sotto la risposta si vede da quanto sta lavorando.
  Se il portatile va a batteria compare "A batteria: più lento" (Windows rallenta il processore anche del doppio).

Come funziona (in due strati, così i numeri sono sempre giusti):
1. **Motore delle risposte** (`src/engine/assistant.js`): capisce l'argomento dalle parole chiave, nomina pezzi e materiali,
   e prepara i "fatti" con i numeri calcolati da Dollaroni (gli stessi di Panoramica, Controlli e Layup Calculator).
   Fa anche le simulazioni (cambio di fibra in un pezzo, aggiunta di materiale) e calcola le idee di risparmio.
   Questa è la risposta della modalità Istantanea e c'è sempre, anche senza IA.
2. **IA locale di Brumoth** (`src/ai/llm.js`, solo modalità Completa): un piccolo modello linguistico (Qwen, licenza Apache 2.0)
   che gira **dentro il browser** con llama.cpp in WebAssembly (libreria wllama). Riceve i fatti e li spiega a parole; non calcola niente.
   Se scrive un numero che non è nei fatti, sotto la risposta compare "Da controllare". Con "Dati usati" si vedono i fatti di partenza.

**Modifiche al progetto (sempre con Applica / Annulla).** Brumoth può anche cambiare i dati del progetto:
"aggiungi 2 kg di carbonio allo scafo" (nuovo substack), "metti 20 kg di MDF nello scafo" (nuova voce),
"crea un pezzo chiamato Timone di riserva nei foil", "aggiungi il materiale Carbon/Innegra a 160 SM$/kg con densità 1,3"
(voce del team nel Listino), "fai la deriva in basalto" (cambio di fibra), "elimina il pezzo Bulkheads".
Non cambia mai niente da solo: mostra una scheda con cosa cambia, il totale e il margine dopo la modifica e i problemi nuovi
(per esempio un limite di carbonio superato), con **Applica** e **Annulla**; dopo "Applica" c'è "Torna indietro" (come Ctrl+Z).
Anche le simulazioni "e se…" che si possono applicare propongono la scheda. Se la richiesta è troppo generica ("aggiungi carbonio")
lo dice e chiede cosa manca (quantità, pezzo, prezzo, densità…). Brumoth modifica i **dati**, non l'app: pagine e funzioni nuove sono sviluppo.

**Istruzioni.** "Come faccio a…" riceve i passaggi con i nomi veri dei pulsanti (pezzi, materiali nuovi, voci, export, S1→S2,
salvataggio, scarti, Performance Rating, aggiornamenti) e, se si può, la scheda per farlo subito. Modifiche e istruzioni
non passano dall'IA: sono testi fissi del motore (`src/engine/actions.js`), quindi esatti anche su un PC lento.

Il modello (modalità Completa):
- si scarica **una volta sola** da Hugging Face la prima volta che si sceglie "Completo" (o all'apertura dell'app, se lo si imposta
  nelle impostazioni ⚙ di Brumoth) e poi resta sul PC, nella memoria del browser di quell'indirizzo: funziona anche senza internet;
- **Standard** (Qwen3.5 2B, circa 1,3 GB): risposte migliori, solo CPU, 2-4 minuti su un portatile; **Leggera** (Qwen3 0,6B,
  circa 0,4 GB): con la scheda video circa 25 s, ma sbaglia più spesso i numeri. Si sceglie e si cancella dalle impostazioni ⚙;
- la scheda video (WebGPU) è accesa di serie solo per la Leggera: con i modelli più grandi le schede video integrate Intel si bloccano.
  Si può accendere o spegnere dalle impostazioni; se dà errore Brumoth riparte da solo senza;
- all'apertura della chat in modalità Completa il modello si carica e legge una volta le istruzioni, che restano in memoria:
  a ogni domanda legge solo i dati e la domanda;
- usa **più core** solo se l'app è aperta da "Avvia Dollaroni.bat" o dal sito installato (serve la "cross-origin isolation", vedi sotto);
- tutto resta sul PC: domande e dati del progetto non vengono inviati a nessuno.

## Aggiornamenti per tutto il team

Ogni PC sa quale versione ha (`version.json`) e controlla se ne esiste una più nuova **all'apertura, ogni 30 minuti e quando si torna
sulla finestra**. Se c'è, compare in basso **"È disponibile Dollaroni x.y.z"** con l'elenco delle novità e il tasto **"Aggiorna ora"**;
se si sono permesse le notifiche, arriva anche una notifica di Windows. Dopo l'aggiornamento si vede una volta la finestra "Novità".
In fondo alla barra laterale ci sono la versione, "Novità" e "Controlla".

Funziona in tutti e due i modi di usare l'app:
- **sito pubblicato** (GitHub Pages, anche installato come programma): il service worker scarica la versione nuova e "Aggiorna ora" la attiva;
- **in locale** con "Avvia Dollaroni.bat": il server locale confronta `version.json` con quello del repository su GitHub; "Aggiorna ora"
  scarica lo zip del branch e sostituisce i file dell'app. Prima fa una copia di quelli vecchi in `out/backup-<versione>-<data>/`.
  Non tocca mai `out/`, i file `*.dollaroni.json` e "Avvia Dollaroni.bat". Se la cartella è un clone git, fa `git pull --ff-only`.
  Se è cambiato anche `tools/devserver.py` chiede di chiudere e riaprire il .bat.

Configurazione in `dollaroni.config.json` → `updates.repository`, per esempio `"sapienza-foiling-team/dollaroni"` (repository **pubblico**).
Finché è vuoto, in locale il controllo è spento (in un clone git il repository si legge dal remote `origin`).

**Pubblicare una versione nuova** (a cosa serve: tutti i PC vedono l'avviso):
1. `python tools/release.py 0.6.0 "Prima novità" "Seconda novità"` aggiorna `version.json` e `CHANGELOG.md`;
2. commit e push su `main`: GitHub esegue i test (`tools/run_tests_headless.py`) e, se passano, pubblica su Pages.

Attenzione: il salvataggio automatico nel browser (e il modello dell'IA) valgono solo per quell'indirizzo. I file `.dollaroni.json` restano la copia da condividere.

## Dall'S1 all'S2

1. A S1 consegnato: **Panoramica → "Congela S1 e crea S2"** (c'è anche in fondo a "Esporta").
   - L'S1 viene salvato dentro il progetto come riferimento fisso (`baseline`).
   - Il progetto diventa S2, con gli stessi pezzi e voci segnati "stimata".
   - Al primo Salva viene chiesto un nuovo file, così quello dell'S1 resta intatto.
2. Durante la costruzione aggiorna ogni voce e ogni pezzo al valore reale, poi clicca **"stimata" → "✓ misurata"**.
   - Nei pezzi c'è anche il **peso reale pesato**: serve per l'autovalutazione della 2.4.
   - Sotto ogni totale compare il valore che aveva nell'S1.
3. **Confronto S1→S2**:
   - differenze per componente: è la tabella di confronto della 2.3;
   - differenze voce per voce, dalla più grande;
   - masse S1, S2 calcolate e pesate;
   - quanto del costo è già misurato.
4. **Esporta S2**: produce
   - il documento con le tabelle della 2.2 (una per componente, con le note sugli sconti e il riepilogo);
   - le tabelle della 2.3 (totale e confronto con l'S1);
   - i dati di supporto per la 2.4 e il mass breakdown as-built;
   - il Layup Calculator e le immagini dei pezzi as-built.

   I testi (2.1, spiegazioni della 2.3, autovalutazione 2.4) li scrive il team.
5. Se un progetto S2 non ha l'S1 dentro (es. creato a mano), da "Confronto" si può collegare il file dell'S1 consegnato.

## Regole 2027

Ogni progetto dice quale regolamento usa (campo `rules`; i file vecchi senza campo sono 2026). I progetti nuovi nascono con le regole 2027;
un progetto 2027 creato prima con le regole 2026 mostra in Panoramica il tasto **"Passa alle regole 2027"**. In alto c'è sempre il badge "Regole 2026/2027".

Cosa cambia con il 2027 SMC Competition Rulebook v1.0 (7 settembre 2026):
- **Budget**: va tenuto *sotto* i 10.000 SM$; sforarlo costa 500 punti (§10.1).
- **Tab. 2** (carbonio): stessi limiti del 2026, "Wingbars" diventa "Hiking racks".
- **Listino**: nel 2027 sta sulla SuMoth Agora Platform, aperta solo ai team ammessi. Finché non la vediamo si usano listino e Layup Calculator 2026, segnati **provvisori**.
- **Sconti di provenienza** (−25/−50/−100%): il regolamento 2027 non li cita più. Restano attivi con un avviso "da confermare su Agora".
- **Parti usate**: non c'è più il costo fisso della vecchia Tab. 3. Si inseriscono come "Parte usata o commerciale" con il prezzo (da Agora) e l'anno di produzione.
- **Performance Rating** (nuova Tab. 3, §11): nella sezione omonima si spuntano le condizioni a)–g) per i 15 componenti; le vele, gli alberi e i foil commerciali prodotti dal 2017 valgono −100 ciascuno (§11.1.5), salvo danni compromettenti. Il rating finisce anche negli export.
- **Scarti in S2** (§9.2.2): nei pezzi laminati (materiale consumato in più, che si somma a quantità e costo) e nei dettagli delle voci ("di cui scarto"). Tabella "Material use and waste" nell'export S2.
- **Scafo upcycled** ammesso solo se in origine era di un'imbarcazione non foiling (§6.2.1): promemoria nei controlli.
- Il mass breakdown as-built non è più richiesto (resta come tabella utile); gli export 2027 non usano la numerazione 2.1–2.4 del template S2 2026.

## Cosa c'è nel motore

- **Import dei file ufficiali** (`src/io/official.js`)
  - Listino `20xx_SMC_Standardized_Costs.xlsx`: le voci diventano il catalogo prezzi. Segnala i materiali senza prezzo e i doppioni.
  - Template `20xx_SMC_Composite_Layup_Calculator.xlsx`: materiali, densità, processi e Vf vengono letti dal file stesso.
  - Quando escono i file dell'anno nuovo basta sostituirli in `data/official/`.
- **Motore layup** (`src/engine/layup.js`): usa le stesse formule del Layup Calculator ufficiale, senza il limite di 5 substack.
- **Costi** (`src/engine/project.js`):
  - voci di listino e lavorazioni a ore;
  - hardware a prezzo MSRP;
  - sconti di provenienza del §3.3: eccedenza industriale −25%, fuori shelf-life −50%, upcycled −100%;
  - parti usate della Tab. 3, con costo fisso e handicap;
  - totali per componente del template S2, margine sul budget, limiti di carbonio della Tab. 2 e mass breakdown del §2.5.
- **Controlli** (`src/engine/checks.js`):
  - budget;
  - carbonio oltre o vicino al limite;
  - quantità dichiarate diverse da quelle del layup;
  - materiali che non esistono nel calcolatore ufficiale;
  - prezzi senza fonte;
  - upcycled senza origine indicata.
- **Tabelle dei report** (`src/engine/reports.js`):
  - S1: tabella "SuMoth Dollar breakdown";
  - S2 §2.2: una tabella per componente, con le note sugli sconti generate in automatico;
  - S2 §2.3: riepilogo e confronto S1→S2;
  - mass breakdown.
- **Export Layup Calculator** (`src/io/layup-export.js`): **un file per pezzo** (Hull, Wing panel, Main vertical…).
  - Parte da una copia del template ufficiale e cambia solo le celle di input. Formule, menu e stili restano quelli dell'organizzazione.
  - I substack non usati vengono nascosti.
  - Un pezzo con più di 5 substack viene diviso in "Pezzo (1/2)", "Pezzo (2/2)".

## Verifiche fatte sui dati 2026

I due progetti in `data/projects/` sono Meravijosa S1 e S2 2026, ricostruiti dai report consegnati.

| Controllo | Risultato |
|---|---|
| Appendice G S1 (8 pezzi, ogni substack) | uguale al grammo |
| Tabella 2 S1 | 8.422,44 SM$, uguale |
| Tabelle 2.1–2.9 S2 (7 componenti) | 9.955,88 SM$, uguale al centesimo |
| Tabella 2.10 (confronto S1→S2) | Δ e variazioni uguali |
| File esportati ricalcolati da LibreOffice con le formule ufficiali | scarto massimo 1e-15 |

Cosa segnalano i controlli sui dati 2026:
- S1: il main horizontal ha **1000,04 g di CFRP su 1000 g** consentiti dalla Tab. 2, quindi lo supera di 0,04 g. Il main vertical è al 98,7% del limite.
- S2: la resina dello scafo è dichiarata 1,44 kg, ma con il Layup Calculator (Vf 35%) ne risultano 2,35 kg (−39%). Il margine sul budget è di 44,12 SM$.

## Pubblicare (GitHub Pages)

Il repository contiene il workflow `.github/workflows/pages.yml`: a ogni push sul branch `main` GitHub
esegue `python tools/build_pwa.py _site` e pubblica la cartella. Lo script copia solo i file dell'app
(niente `out/`, note interne o file progetto `*.dollaroni.json`, esclusi anche da `.gitignore`) e scrive in `sw.js`
la versione (impronta dei file) e l'elenco dei file da tenere offline.

Prima volta: nelle impostazioni del repository, Pages > Source: **GitHub Actions**. Il sito sarà su
`https://<account>.github.io/<repository>/`. Poi scrivere il repository in `dollaroni.config.json` (vedi "Aggiornamenti").

Il workflow, prima di pubblicare, lancia `python tools/run_tests_headless.py`: se un test fallisce la versione non viene pubblicata.

**Cross-origin isolation.** Il server locale manda gli header `Cross-Origin-Opener-Policy: same-origin` e
`Cross-Origin-Embedder-Policy: require-corp`; su GitHub Pages li aggiunge il service worker (dalla seconda apertura in poi).
Servono all'IA per usare più core. Effetto collaterale da ricordare: i popup di login di altri siti (es. Google) non possono
comunicare con la pagina, e iframe di altri siti vanno caricati con `credentialless`. Il server si può avviare con `--no-isolation`.

Per provare l'app installabile in locale (in locale il service worker normalmente è spento):

```bash
python tools/build_pwa.py out/site
python tools/devserver.py 8766 --root=out/site
```

e aprire http://127.0.0.1:8766/?pwa. Le icone si rigenerano con `python tools/make_icons.py`.

## Come si provano i test

Serve solo Python (nessuna installazione di Node).

```bash
python tools/devserver.py
```

Poi apri http://127.0.0.1:8765/tests/ nel browser: deve comparire "67/67 test superati".
I test salvano anche gli xlsx del Layup Calculator in `out/layup-s1/`.

Senza aprire finestre (usa Chrome o Edge in modalità headless, come fa GitHub prima di pubblicare):

```bash
python tools/run_tests_headless.py
```

Per ricontrollarli con le formule ufficiali, tramite LibreOffice:

```bash
python tools/verify_layup_export.py out/layup-s1
```

## Struttura

```
index.html         l'app
Avvia Dollaroni.bat avvio con doppio clic (server locale + browser)
version.json       versione installata e note (le confronta il controllo aggiornamenti)
CHANGELOG.md       storia delle versioni
dollaroni.config.json  repository GitHub da cui aggiornarsi
styles/app.css     grafica
src/app/           interfaccia (Preact + htm, niente build): app.js, views/ (anche assistant.js, Brumoth: barchetta, fumetto e chat), store.js, updates.js, pwa.js
src/ai/            IA locale di Brumoth nel browser (llm.js: download, cache, avvio, risposte in streaming)
src/engine/        regole per anno (rules.js, rules-2026.js, rules-2027.js), calcolo layup, costi, Performance Rating, controlli, tabelle report,
                   assistant.js (motore delle risposte di Brumoth)
src/io/            lettura/scrittura xlsx, import file ufficiali, export template, docx, immagini
data/official/     file ufficiali SuMoth (listino costi, Layup Calculator)
data/projects/     progetti di esempio (Meravijosa S1 e S2 2026)
tests/             test nel browser (golden test sui dati 2026)
tools/             server locale (con aggiornamenti), test headless, release.py, verifica con LibreOffice, build del sito (build_pwa.py), icone
sw.js, manifest.webmanifest, icons/   app installabile (service worker, manifest, icone)
.github/workflows/ pubblicazione su GitHub Pages
vendor/            JSZip 3.10.1 (MIT), htm 3.1.1 + Preact (MIT), wllama 3.8.1 (MIT, llama.cpp in WebAssembly)
```

## Formato del progetto (`dollaroni/1`)

```jsonc
{
  "schema": "dollaroni/1", "name": "Meravijosa", "season": 2026, "stage": "S1", "concept": "NEW",
  "catalogExtras": [ { "id": "hw-blocks", "name": "Blocks", "unit": "pc", "price": 32.5, "priceSource": "MSRP Harken" } ],
  "parts": [ {
    "id": "hull", "name": "Hull",
    "component": "hull",          // categoria S2: hull, foils, mechanical_control, gantry, wingbars, rig, electronics
    "limitGroup": "hull",         // colonna Tab. 2 per i limiti di carbonio
    "massGroup": "hull",          // riga del mass breakdown §2.5: hull, wings, horizontal_foils, vertical_foils
    "autoLines": true,            // true = le righe di costo fibra/resina/anima si generano da sole
    "substacks": [ { "reinforcement": "dry-fabric-basalt-fibers", "matrix": "std-epoxy/lamination-resin",
                     "plyArea": 3.997, "plies": 4, "arealWeight": 340, "process": "HAND LAYUP + VAC",
                     "matrixSource": "out_of_shelf_life" } ],
    "core": { "ref": "pet/recycled", "mass": 0.72, "resinUptake": 250, "area": 2.0 }
  } ],
  "lines": [ {
    "id": "hull-mould", "component": "hull", "name": "Hull - mould", "s2Label": "MDF (mould blocks)",
    "material": { "ref": "mdf-hdf-wood", "qty": 110, "source": "new" },
    "process":  { "ref": "machining", "hours": 30, "s2Label": "CNC Machining (mould milling)" }
  }, {
    "id": "foil-mv", "component": "foils", "name": "Main Vertical", "usedPart": { "element": "main_vertical", "year": 2014 }
  } ]
}
```

- **`source`** (provenienza):
  - `new`
  - `industrial_excess` (−25%)
  - `out_of_shelf_life` (−50%)
  - `upcycled` (−100%): va indicata l'origine in `origin`.
- **I materiali riciclati** hanno la loro voce di listino, per esempio `pet/recycled` a 0 SM$.
- **Quantità da controllare contro il layup**: `"check": {"parts": ["hull"], "kind": "fibre" | "resin" | "core"}`.

## Prossimi passi

0. Listino 2027 da SuMoth Agora (quando il team è ammesso): sostituire i file provvisori in `rules-2027.js` e togliere gli avvisi sugli sconti se non esistono più.
1. Salvataggio condiviso su Google Drive con login Google, con unione delle modifiche fatte da più persone.
2. Pubblicazione su GitHub Pages: app installabile, aggiornamenti e test prima della pubblicazione sono pronti; manca creare il repository, scriverlo in `dollaroni.config.json` e fare il primo push.
3. Controllo in Google Docs dei documenti importati: i file di prova sono in `Barca\Dollaroni - prova Google Docs`.
