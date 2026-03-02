# Padel Auto-Reservering

Automatisch een padelbaan reserveren op [Sportcentrum Oudenrijn](https://oudenrijn.baanreserveren.nl) voor elke week.

## Hoe werkt het?

Het script logt in op de website, controleert beschikbaarheid 14 dagen vooruit en reserveert de beste beschikbare slot in deze volgorde:

| Prioriteit | Dag | Tijd |
|---|---|---|
| 1 | Maandag | 19:00–20:00 |
| 2 | Maandag | 20:00–21:00 |
| 3 | Dinsdag | 19:00–20:00 |
| 4 | Dinsdag | 20:00–21:00 |
| 5 | Woensdag (fallback) | 19:00–20:00 |
| 6 | Woensdag (fallback) | 20:00–21:00 |

**Spelers**: Menno Mink (account), Hugo Mink, Menno Ekelschot, Robin Meijer.

---

## GitHub Actions (automatisch)

Het script draait automatisch via GitHub Actions:

- **Schema**: Maandag, dinsdag en woensdag om 19:00 CET
- **Weeklogica**: Na 1 geslaagde reservering stopt het script voor de rest van de week
- **Handmatig**: Kan ook handmatig gestart worden via GitHub → Actions → "Run workflow"

### Secrets instellen

Ga naar **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**:

- `BR_USERNAME` → `Mennomink`
- `BR_PASSWORD` → `tg4baan@MM!`

---

## Lokaal installeren

```powershell
cd c:\AI_Projects\Baanreseveren
npm install
```

## Lokaal uitvoeren

```powershell
# Dry-run (check beschikbaarheid, boek NIET)
npm run dry-run

# Echte reservering maken
npm run reserve

# Test-reservering (zondag 11:00)
node src/reserve.js --test
```

## Logbestand

Resultaten worden opgeslagen in `logs/reservation.log`.
