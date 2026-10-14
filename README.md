# Chi chiude perde

Il gioco di parole che si fa in macchina, su una griglia di lettere come Ruzzle.

**Gioca:** https://massey8280.github.io/chi-chiude-perde/

## Regole in breve

1. A turno si aggiunge una lettera **vicina all'ultima** (anche in diagonale). Ogni casella una volta sola.
2. Se esce una parola che sulla griglia **si può ancora allungare** (GATTO → GATTONE), si continua.
3. **Perde chi chiude**: chi mette l'ultima lettera di una parola che non si può più allungare.
4. Pensi che l'altro bluffi? **Sfida!** Deve tracciare la sua parola sulla griglia: se non ce l'ha perde lui, se ce l'ha perdi tu.
5. Ogni round perso vale una lettera di **STOP**.

## Con più telefoni

Uno crea la stanza e manda il link (o fa inquadrare il QR). Chi lo apre scrive il nome ed è dentro:
niente account, niente app. Si può anche giocare da soli contro il computer o passandosi il telefono.

## Come è fatto

- `index.html` — tutto il gioco in un file: griglia, dizionario italiano (~50.000 parole con plurali,
  femminili, diminutivi, accrescitivi e vezzeggiativi), computer a tre livelli, analisi della mossa decisiva.
- Le mosse tra telefoni passano da due broker MQTT pubblici e gratuiti insieme (`broker.emqx.io` e
  `broker.hivemq.com`): basta che uno dei due risponda. Ogni stanza ha uno stato con versione; chi arriva
  lo chiede ai telefoni presenti, e chiunque veda uno stato più vecchio rimanda quello giusto, così
  tutti convergono anche se un broker non conserva i messaggi. Tutto ciò che arriva dagli altri
  telefoni viene controllato prima di essere mostrato.
- `vps/` — la stessa cosa con un server proprio (Node + WebSocket in Docker, dietro nginx), per
  quando si vuole farla girare su un server di casa invece che sul broker pubblico.

Font Overpass e Barlow (SIL Open Font License), QR con `qrcode-generator` (MIT), MQTT con `mqtt.js` (MIT).
