# Whisper – med Aivia i örat

Whisper är appen, Aivia är assistenten. Aivia lyssnar på samtalet i bakgrunden och viskar ett smart svar i dina hörlurar när du behöver det.

Appen har fem flikar längst ner: **Lyssna**, **Förbered**, **Sammanfatta**, **Kalender** och **Inställningar**.

1. Någon ställer en fråga. Du trycker **en gång** på hörlurarnas knapp (eller skärmen).
2. Du hör direkt ett **kort svar** i örat. Säg det högt medan du hör det. Appen fortsätter prata, och det du själv säger räknas inte som en ny fråga.
3. Kommer det en ny fråga trycker du igen. Trycker du direkt efter svaret, innan något nytt har sagts, får du i stället en **längre förklaring** (3–5 meningar).

Om ingen tydlig fråga ställdes får du i stället en klok kommentar om det ni pratar om.

**Förbered:** inför en intervju, ett möte eller en redovisning går du till **Förbered** och laddar upp ditt underlag: CV, personligt brev, jobbannonsen, projekt, presentationen eller anteckningar (PDF, Word, PowerPoint, text eller en bild/skärmdump). Då bygger svaren i örat på det, med riktiga namn, siffror och projekt i stället för allmänna svar. Trycker du **Förbered mig** får du också en presentation av dig själv, de troligaste frågorna med färdiga svar (som du kan lyssna på), saker att komma ihåg, frågor du kan ställa och svaga punkter att vara beredd på. Du kan ha flera förberedelser sparade och välja vilken som används.

**Sammanfatta:** efter ett möte, en föreläsning, en redovisning, en debatt eller ett samtal går du till **Sammanfatta**. Du får en sammanfattning, beslut, en att göra-lista och öppna frågor. Tider och dina egna uppgifter hamnar automatiskt i **Kalender**. Du kan också be Aivia om något, t.ex. ”skriv ett mejl till Erik om det vi bestämde”.

**Kalender och påminnelser:** skriv t.ex. ”Tandläkare torsdag kl 14” eller ”Påminn mig att ringa mamma imorgon kl 10” under **Be Aivia lägga till**, eller tryck **+ Lägg till själv**. Aivia påminner dig med en banner i appen (och i örat om du lyssnar) så länge appen är öppen. Vill du bli påmind även när appen är stängd trycker du **iPhone-kalender** (eller **Lägg alla kommande i iPhone-kalendern**), så får telefonens kalender ett riktigt larm.

**Appens språk:** Inställningar → **Appens språk**: Auto (samma som telefonen), Svenska, Dansk eller English. Det påverkar bara knappar och texter. Språket Aivia lyssnar och svarar på väljer du separat under **Samtalets språk**.

Appen är en webbapp (Next.js) som du öppnar i Safari på iPhonen och lägger på hemskärmen. AI-nycklarna ligger bara på servern, aldrig i telefonen.

---

## 1. Kom igång på datorn (5 minuter, gratis)

Du behöver [Node.js](https://nodejs.org) 20.9 eller senare (du har redan Node 24).

**Skaffa en gratis nyckel från Groq** (inget kort krävs):

1. Gå till [console.groq.com/keys](https://console.groq.com/keys) och logga in, t.ex. med Google.
2. Klicka **Create API Key** och kopiera nyckeln (den börjar med `gsk_`).

**Lägg in nyckeln och starta** (PowerShell):

```powershell
cd C:\Users\arvin\Documents\psst
npm install
copy .env.example .env.local
notepad .env.local
```

Skriv in nyckeln på raden `GROQ_API_KEY=gsk_...`, spara och stäng. Starta sedan:

```powershell
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000) i Chrome eller Edge:

- **Testa med text (utan mikrofon):** skriv t.ex. ”Vad är huvudstaden i Australien?” och tryck på cirkeln en gång.
- **Starta:** använder datorns mikrofon (fungerar på `localhost` utan HTTPS).
- Öppna **Inställningar → Kör självtest** för att se att nyckeln fungerar och hur snabbt varje del svarar.

### Prova utan nyckel (testläge)

Testläget ger påhittade svar och gör inga AI-anrop. Det är bra för att prova knapparna och flödet:

```powershell
$env:MOCK_AI="1"; npm run dev
```

(Eller sätt `MOCK_AI=1` i `.env.local`.) Appen visar en gul etikett ”Testläge” när det är på.

---

## 2. Använd den på iPhonen

iPhonen tillåter bara mikrofonen på sidor med **HTTPS**, så `http://192.168…` fungerar inte. Välj ett av alternativen nedan.

### Alternativ A: Tunnel från datorn (snabbast att testa)

En gratis Cloudflare-tunnel ger datorn en tillfällig `https://`-adress.

1. Sätt ett lösenord i `.env.local`, t.ex. `APP_PASSWORD=hemligt123`, eftersom adressen är publik så länge tunneln är igång.
2. Installera cloudflared (en gång) och öppna sedan ett **nytt** PowerShell-fönster:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

3. Fönster 1, starta appen i produktionsläge (snabbare än `npm run dev`):

   ```powershell
   cd C:\Users\arvin\Documents\psst
   npm run build
   npm start
   ```

4. Fönster 2, starta tunneln:

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

5. Kopiera adressen som slutar på `.trycloudflare.com` och öppna den i **Safari** på iPhonen.

Adressen byts varje gång du startar tunneln. Datorn måste vara på och vara kvar på samma ställe.

### Alternativ B: Vercel (fast adress, gratis)

Då fungerar appen utan att datorn är på, och ikonen på hemskärmen fortsätter att fungera.

1. Skapa ett gratis konto på [vercel.com](https://vercel.com).
2. I PowerShell i projektmappen:

   ```powershell
   npx vercel
   ```

   Logga in och svara ja på standardfrågorna.
3. Gå in på projektet på vercel.com → **Settings → Environment Variables** och lägg till:
   - `GROQ_API_KEY` (och eventuella andra nycklar)
   - `APP_PASSWORD` – **krävs**. Utan det vägrar appen göra AI-anrop, så att ingen annan kan använda dina nycklar.
4. Publicera:

   ```powershell
   npx vercel --prod
   ```

5. Öppna adressen (`https://…vercel.app`) i Safari på iPhonen och ange lösenordet en gång. Det sparas i telefonen.

Vercels gratisplan (Hobby) är bara för privat bruk. Om du börjar ta betalt behöver du Pro-planen.

### Flera användare (familj och vänner)

Flera personer kan använda appen samtidigt. Var och en öppnar samma adress på sin egen telefon, och allt de sparar (samtalstext, förberedelser, sammanfattningar, kalender) stannar på deras telefon. Alla AI-anrop går på dina nycklar, så sätt gärna en månadsgräns hos Anthropic och OpenAI.

Vill du ge varje person en egen kod i stället för ditt lösenord, lägg till `APP_USERS` i Vercel (eller `.env.local`):

```text
APP_USERS=Mamma:sol123,Pappa:hav456,Sara:skog789
```

Varje kod måste vara minst 4 tecken. `APP_PASSWORD` fungerar fortfarande. Ta bort ett namn för att stänga av den personen. Namnet syns under Inställningar → Kod och i telefonloggen (`[telefon Mamma]`).

### Köra på din egen dator (whisper.teknikfix.dk)

Appen kan köras på samma dator som teknikfix.dk, via samma Cloudflare-tunnel. Det kostar inget extra och räcker gott för de första 10–30 användarna (servern skickar bara vidare till AI-tjänsterna). Datorn måste vara på och ha internet.

- `run-whisper.bat` bygger appen första gången och startar den på port 4323. Den ligger i Windows Autostart (`Whisper online`), så den startar av sig själv.
- Tunneln (`C:\Users\arvin\.cloudflared\config.yml`) skickar `whisper.teknikfix.dk` till `localhost:4323`.
- Efter kodändringar: kör `npx next build` och starta sedan `run-whisper.bat` igen.
- Loggen hamnar i `data\server.log`.

### Konton och betalning

När `SESSION_SECRET` är satt (bara på egen dator, inte på Vercel) kan vem som helst skapa ett konto. Kontona sparas i `data\accounts.json` (lösenorden krypterade). Ta en kopia av filen då och då.

Sätt att logga in (den som loggar in första gången får ett konto):

- **E-postkod:** kunden skriver sin e-post och får en kod med 6 siffror (gäller 15 min). Kräver `RESEND_API_KEY` och `MAIL_FROM` (samma Resend-konto och domän som teknikfix.dk).
- **Lösenord:** för den som har satt ett. **Glömt lösenordet?** mejlar en kod, och kunden väljer ett nytt lösenord själv.
- **Google / Apple / Facebook / Microsoft:** knapparna syns när nycklarna finns i `.env.local` (se `.env.example`). Omdirigeringsadressen är `https://whisper.teknikfix.dk/api/auth/<google|apple|facebook|microsoft>/callback`. Integritetspolicyn som Google, Apple och Facebook frågar efter ligger på `https://whisper.teknikfix.dk/integritet`.
- **Familjekoder** (`APP_USERS`) fungerar som förut under "Jag har en kod".

Kunden betalar för det den använder, från ett saldo som fylls på som ett kontantkort (priser i `src/lib/shared/pricing.ts`, inkl. moms):

| | SEK | DKK |
| --- | --- | --- |
| Gratis test | 20 minuter, svar ingår (högst 40 svar) | samma |
| Lyssna | 10 öre per minut tal | 7 øre |
| Svar | 50 öre per tryck som ger ett svar | 35 øre |
| Fyll på | 50 / 100 / 250 kr | 35 / 70 / 175 kr |

Saldot sparas i svenska öre och visas i DKK för den som betalat i DKK. Minuterna räknas på ljudet som skickas till taligenkänningen, så tystnad kostar inget. Svaret dras när appen visar ett svar efter ett tryck, inte för förberedda svar i bakgrunden. Familjekoderna (`APP_USERS`) och `APP_PASSWORD` har ingen gräns.

Gratisminuterna kräver inget kort, och inga priser visas förrän de är slut. Alla konton tillsammans får högst `TRIAL_DAILY_HOURS` (10) gratistimmar per dygn. Samma person får inte nya gratisminuter genom att göra nya konton: de kopplas till e-postadressen (utan `+tillägg`, och för Gmail utan punkter), till telefonen (ett slumpat id i appen) och högst 3 nya per nätverk och vecka. Tillfälliga engångsadresser (mailinator m.fl.) stoppas. Ett konto som inte får gratisminuter kan ändå fylla på direkt.

Så slår du på betalningen:

1. Lägg in `STRIPE_SECRET_KEY` i `.env.local` (börja med en testnyckel `sk_test_...`). Priserna skapas automatiskt i Stripe första gången någon fyller på.
2. Stripe → Developers → Webhooks → lägg till `https://whisper.teknikfix.dk/api/stripe/webhook` med händelserna `checkout.session.completed` och `checkout.session.async_payment_succeeded`. Kopiera *Signing secret* till `STRIPE_WEBHOOK_SECRET`.
3. Stripe → Settings → Billing → Customer portal: slå på den (kunderna ser sina kvitton där).
4. Starta om `run-whisper.bat`.

Glömt lösenord sköter kunden själv med en kod på mejlen. Vill du ändå sätta ett lösenord åt någon: `node scripts/reset-password.mjs kund@mail.se NyttLosen123`. Saldot och gratisminuterna finns kvar.

Påminnelser-appen på iPhone: webbappar får inte skriva där direkt, så knappen **Påminnelser** i Sammanfatta kör genvägen "Whisper påminnelse". Bygg den en gång i Genvägar-appen (stegen visas i appen), dela den (Dela → Kopiera iCloud-länk) och lägg länken i `REMINDERS_SHORTCUT_URL`, så får kunderna en "Hämta genvägen"-knapp.

### Första gången på iPhonen

1. Öppna adressen i **Safari**, tryck på **Dela** → **Lägg till på hemskärmen** och öppna sedan Whisper från hemskärmen (helskärm). Skriv in din kod.
2. Sätt i hörlurarna, tryck **Starta** och tillåt mikrofonen.
3. **Inställningar → Mikrofon:** välj **iPhone-mikrofonen** om den finns. AirPods-mikrofonen hör mest dig, inte de andra.
4. **Inställningar → Testa rösten** och **Kör självtest.**
5. Om skärmen ändå släcks: **Inställningar → Skärm och ljusstyrka → Automatisk låsning → Aldrig** medan du använder appen.

---

## 3. Så styr du

| Vad du vill | På skärmen | Hörlurarnas knapp |
|---|---|---|
| Kort svar direkt, sedan lyssna vidare | Tryck på cirkeln | 1 tryck |
| Upprepa det senaste svaret | Håll inne cirkeln, eller **Upprepa** | 2 tryck |
| Avbryt och börja lyssna igen | – | 3 tryck |
| Analysera på nytt direkt | **Ny fråga** | – |

- **Smygläge:** hela skärmen blir svart (ser avstängd ut). Tryck var som helst = knappen, håll inne = upprepa, dubbeltryck i övre vänstra hörnet = avsluta.
- Efter det korta svaret lyssnar appen vidare. Har något nytt sagts när du trycker letar den efter den nya frågan. Är allt tyst får du förklaringen till svaret du nyss hörde (i 45 sekunder, sedan räknas trycket som en ny fråga).
- Frågor du redan har fått svar på besvaras inte igen. Finns ingen ny fråga hör du ”Ingen ny fråga än”. **Rensa** under Live-text glömmer både texten och svaren.
- Det du säger när du upprepar svaret visas som **Du** i Live-texten. Det räknas inte som en ny fråga, men kommer med i sammanfattningen.
- Trycker du under det korta svaret får du förklaringen direkt.
- **Blir svaret tyst så fort du börjar prata?** Det är AirPods funktion Konversationsmedvetenhet som sänker ljudet när du pratar. Stäng av den: Inställningar → dina AirPods → Konversationsmedvetenhet → Av.
- På AirPods trycker du på skaftet (äldre AirPods: dubbelknacka, vilket bara ger ”1 tryck”). På sladdlurar är det mittknappen.
- När mikrofonen är på behandlar iPhonen ett tryck på AirPods-skaftet som mute-knappen i ett samtal, och du hör en kort ton. Psst räknar det som ett tryck och slår på mikrofonen igen direkt. 2 och 3 tryck fungerar då inte säkert. Använd skärmen för att upprepa eller avbryta.

## 4. Inställningar

- **Om dig:** t.ex. ”Jag pluggar datateknik på KTH och bor i Köpenhamn”. Svaren anpassas efter det.
- **Stil:** Smart (avslappnat och skarpt), Expert (exakt och auktoritativt) eller Kvick (med en klurig twist).
- **Appens språk:** språket på knappar och texter (Auto följer telefonen).
- **Samtalets språk:** Auto svarar på frågans språk. Välj Svenska, Dansk eller English om igenkänningen blir fel.
- **Röst:** Molnröst (naturligast, kräver Azure- eller OpenAI-nyckel) eller Telefonens röst, plus talhastighet. Väljer du English blir även signalerna (”Answer ready…”) engelska.
- **Meddelanden i örat:** korta besked som ”Ingen ny fråga än” som mening, kort eller pip. Du kan också få ett pip när appen själv hör en fråga.
- **Mikrofon:** välj mikrofon och känslighet.
- **Minne:** hur många minuter bakåt AI:n tittar (standard 3).

## 5. Vilken AI-tjänst?

**Rekommenderat upplägg** (smart, snabbt och riktig svensk röst):

| Del | Tjänst | Nyckel i `.env.local` | Pris (oktober 2026) |
|---|---|---|---|
| Svar | Claude Haiku 5.5 (Anthropic) | `ANTHROPIC_API_KEY` | 0,10 USD per miljon tokens in, 0,50 ut, under 1 krona per 100 svar |
| Taligenkänning | Whisper på Groq | `GROQ_API_KEY` | Gratis, eller 0,04 USD per timme ljud med betalkonto |
| Röst | Azure (Microsoft), svenska röster | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | 0,5 miljoner tecken gratis per månad, sedan 15 USD per miljon |

- **Abonnemang räknas inte.** Claude Pro och Gemini-abonnemang gäller bara apparna. API:t är ett separat konto där du fyller på kredit: [console.anthropic.com](https://console.anthropic.com/settings/keys).
- **Azure-nyckel:** skapa ett konto på [portal.azure.com](https://portal.azure.com) och sedan en resurs av typen **Speech**. Välj prisnivå **Free F0** och regionen **Sweden Central**. Under **Keys and Endpoint** kopierar du **KEY 1**, och regionen anger du som `swedencentral`.
- **Allt via OpenAI** (en nyckel, `OPENAI_API_KEY`) fungerar också och kostar ungefär lika lite, men OpenAI:s röster kan låta lite amerikanska på svenska.
- **Taligenkänning via OpenAI i stället för Groq:** lägg in `OPENAI_API_KEY` (gpt-transcribe, cirka 0,27 USD per timme ljud) och sätt `LLM_PROVIDER=anthropic`, så svarar Claude fortfarande. Utan Azure-nyckel används då OpenAI:s röst.
- Med `auto` väljer appen den första tjänsten som har en nyckel: OpenAI → Claude → Groq → DeepSeek för svaren, OpenAI → Groq för igenkänningen och Azure → OpenAI för rösten.
- Med bara Groq används **snålläge** automatiskt, så att gratisgränserna räcker. Svar förbereds bara i bakgrunden när någon säger något med ”?”, och förklaringen hämtas först när du ber om den.
- Alla inställningar finns förklarade i `.env.example`. Starta om servern när du ändrar `.env.local`.

## 6. Begränsningar och tips

- **Skärmen måste vara på och Whisper öppen.** iOS stänger av mikrofonen för webbappar när skärmen låses eller du byter app. Lägg telefonen med skärmen nedåt och styr med hörlurarna, eller använd Smygläge. Det drar mer batteri än vanligt.
- **Hörlursknappar varierar.** Appen tar emot play/paus, nästa och föregående låt via iOS mediakontroller. Det fungerar med AirPods och de flesta lurar, men inte garanterat. Använd skärmen om knappen inte gör något.
- **Telefonens röst kan bli tyst** på vissa iPhones när mikrofonen är igång. Appen varnar då, och molnrösten (Azure eller OpenAI) löser det.
- **Gratisgränser:** om du hör ”Gratisgränsen är nådd”, vänta en minut. Aktuella gränser finns på [console.groq.com/settings/limits](https://console.groq.com/settings/limits).
- Ofta är svaret redo direkt när du trycker, eftersom det förbereds medan frågan ställs. Annars tar det några sekunder.

## 7. Felsökning

- **Mikrofonen startar inte på iPhonen:** kontrollera att adressen börjar med `https://`. Tillåt mikrofonen under **Inställningar → Appar → Safari → Mikrofon**.
- **”Fel eller saknad kod”:** ange `APP_PASSWORD` eller en av koderna i `APP_USERS`.
- **Självtestet säger att nyckeln är fel:** kontrollera nyckeln i `.env.local` (eller i Vercel) och starta om servern, eller gör en ny deploy.
- **Groq: Create API Key är grå och Organization ID är tomt:** kontot fick ingen organisation. Använd OpenAI för taligenkänningen i stället (avsnitt 5).
- **Inget ljud:** höj volymen och tryck på **Testa rösten**. Byt mellan Molnröst och Telefonens röst.
- **Uttalet låter engelskt (svengelska):** enheten saknar svensk röst och läser då svenskan med en engelsk röst. Appen visar en varning med instruktioner. Lägg till en svensk röst (Windows: Settings → Time & language → Speech → Add voices; iPhone: Inställningar → Hjälpmedel → Uppläst innehåll → Röster), öppna appen i Microsoft Edge på datorn, eller använd Azure-rösten.
- **Fel språk i texten:** välj språk under Inställningar → Språk.
- **AirPods-knappen gör ingenting, eller Live-text slutar fyllas på efter ett tryck:** när mikrofonen är på stänger iPhonen av den vid ett tryck på skaftet, som i ett telefonsamtal. Psst räknar det som ett tryck, slår på mikrofonen igen och startar om den om det behövs. Hjälper inte det, sätt `PHONE_LOG=1` (i `.env.local` eller hos Vercel) och starta om servern eller publicera på nytt. Då skickar telefonen en logg över vad som händer: i serverns terminal, eller under Logs hos Vercel (rader som börjar med `[telefon]`).

## 8. Integritet och ansvar

- Ljud sparas aldrig. Korta ljudklipp skickas till den AI-tjänst du valt för att bli text. Texten sparas bara i telefonen (så att en sammanfattning fungerar även om sidan laddas om) och raderas efter 12 timmar eller när du trycker **Rensa**. Sammanfattningar sparas i telefonen tills du tar bort dem.
- Filer du laddar upp under **Förbered** läses av servern (bilder och skannade PDF:er av AI-tjänsten) och sparas inte där. Bara texten sparas, i telefonen, tills du tar bort förberedelsen. Texten skickas med varje svar så länge förberedelsen används.
- Kalenderknappen skapar en kalenderfil som telefonen öppnar i Kalender. Ingenting läggs in utan att du godkänner det.
- Appen lyssnar på andra människor. Var öppen med det när det spelar roll, och använd den inte på prov, tentor, intervjuer eller där hjälpmedel är förbjudna.
- Om du gör det här till en produkt för andra behöver du användarvillkor och en integritetspolicy (GDPR), eftersom röster från andra skickas till en molntjänst.

---

## För utvecklare

```text
src/app/api/       Server: transcribe, answer, summary, extract, prepare, ics, tts, config, selftest
src/lib/server/    AI-leverantörer (Groq, OpenAI, Anthropic, DeepSeek), lösenord, validering
src/lib/client/    Ljudmotor (mikrofon, röstdetektering, WAV), tillståndsmaskin, röst, hörlursknappar
src/lib/i18n/      Appens texter på svenska, danska och engelska
src/components/    Gränssnitt (flikar: lyssna, förbered, sammanfatta, kalender, inställningar)
public/worklets/   AudioWorklet som läser mikrofonen
```

```powershell
npm run dev          # utvecklingsserver
npm run build        # produktionsbygge
npm start            # kör produktionsbygget
npm run lint         # eslint
npx tsc --noEmit     # typkontroll
```
