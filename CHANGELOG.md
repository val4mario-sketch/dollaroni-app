# Novità di Dollaroni

Le versioni seguono `MAGGIORE.MINORE.CORREZIONE`. La versione in uso e le sue note stanno in `version.json`:
per pubblicarne una nuova usa `python tools/release.py <versione> "nota" "nota"` (aggiorna entrambi i file).

## 0.5.0 – 26/10/2026
- Brumoth, l'assistente di Dollaroni: la barchetta in basso a destra (con il fumetto "Chiedi a Brumoth!") apre una chat che risponde sul progetto aperto (budget, carbonio, classifiche, simulazioni, regolamento) usando i numeri calcolati dall'app.
- Brumoth può modificare il progetto (aggiungere fibra a un pezzo, voci, pezzi nuovi, materiali nel listino, cambiare fibra, eliminare un pezzo), sempre mostrando prima cosa cambia e l'effetto su budget e limiti, con Applica / Annulla. Se la richiesta è troppo generica lo dice e chiede cosa manca. Spiega anche passo passo come fare le cose nell'app.
- Brumoth ha due modalità, scelte dal menu sotto la chat: Istantaneo (risposte subito, dai dati) e Completo (l'IA locale riscrive la risposta a parole sue: ci mette di più, da mezzo minuto a qualche minuto). L'IA gira nel browser, si scarica una volta sola e poi funziona anche senza internet.
- Aggiornamenti: avviso "Nuova versione disponibile" con le novità anche per chi usa Avvia Dollaroni.bat, e aggiornamento con un clic.

## 0.4.0 – 28/09/2026
- Regole 2027 (budget sotto i 10.000 SM$, Performance Rating, scarti in S2, parti usate a prezzo), app installabile da GitHub Pages.

## 0.3.0
- Passaggio S1 → S2: congela S1, confronto, Esporta S2.

## 0.2.0
- Interfaccia: panoramica, pezzi laminati, voci di costo, controlli, listino, Esporta S1.

## 0.1.0
- Motore di calcolo: listino e Layup Calculator ufficiali, costi, limiti di carbonio, masse.
