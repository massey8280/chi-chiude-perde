# Chi chiude perde — online

Il gioco di parole della macchina su una griglia, giocabile con più telefoni: uno crea la stanza,
gli altri entrano con il codice di 4 lettere, il QR o il link. Niente account, niente app.

## Cosa c'è qui

- `www/` — il sito: `index.html` (gioco completo, dizionario incluso), font, icone, manifest.
- `relay/` — il server della stanza (Node 22 + `ws`): tiene in memoria lo stato di ogni partita con un
  numero di versione e lo inoltra agli altri telefoni. Serve anche i file di `www/`.
- `docker-compose.yml` — un solo container, `parole-relay`, agganciato alla rete `sensori-iot_default`
  così che `sensori-nginx` lo raggiunga per nome. Nessuna porta esposta all'esterno.
- `nginx-parole.conf` — i due blocchi `server` per `parole.sensori-iot.duckdns.org`.

## Come funziona la sincronia

Ogni telefono gioca solo il proprio turno. Applica la mossa, poi manda tutto lo stato come versione
v+1; il server la accetta solo se nessuno è arrivato prima, e la inoltra agli altri. Se due telefoni
premono insieme, uno vince e l'altro si riallinea da solo. Chi perde il segnale rientra da solo e
ritrova la partita. Se il container si riavvia, il primo telefono che rientra ripubblica la partita.

## Aggiornare il gioco

Basta sostituire `www/index.html` (è montato in sola lettura nel container): niente rebuild.
Per cambiare il server: `docker compose up -d --build` in questa cartella.

## Controlli

- `docker exec parole-relay wget -qO- http://127.0.0.1:8080/healthz` → `{"ok":true,...}`
- Log: `docker logs --tail 50 parole-relay` (non registra nomi né mosse, solo l'avvio).

Limiti: 12 telefoni per stanza (6 giocano, gli altri guardano), stanze dimenticate dopo 12 ore senza nessuno.
I font (Overpass, Barlow) sono SIL Open Font License, licenze in `www/fonts/`.
