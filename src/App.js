import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

// TODO: paste your key between quotes:
const genAI = new GoogleGenerativeAI('YOUR_API_KEY_HERE');
// Simple registry of known UPI handles (PSPs)
const KNOWN_UPI_HANDLES = {
  okaxis: { psp: 'Axis Bank UPI handle', note: 'Large bank PSP, still cannot verify receiver account.' },
  oksbi: { psp: 'SBI UPI handle', note: 'State Bank PSP; format alone cannot prove safety.' },
  ybl: { psp: 'Yes Bank UPI handle', note: 'Used by many apps like PhonePe etc.' },
  paytm: { psp: 'Paytm UPI handle', note: 'Wallet/PSP; always double‑check beneficiary details.' },
  okhdfcbank: { psp: 'HDFC Bank UPI handle', note: 'Bank PSP; treat unknown beneficiaries with caution.' },
  icici: { psp: 'ICICI Bank UPI handle', note: 'Bank PSP; cannot see account type or age.' },
};

function App() {
  const [mode, setMode] = useState('protect'); // 'protect' | 'bait'

  // Protect mode state
  const [caseType, setCaseType] = useState('upi'); // 'upi' | 'digital'
  const [lang, setLang] = useState('hi'); // hi / mr / en
  const [protectInput, setProtectInput] = useState(''); // UPI / text / account context
  const [protectResult, setProtectResult] = useState('');
  const [loadingProtect, setLoadingProtect] = useState(false);
  const [accountRiskNote, setAccountRiskNote] = useState(''); // mule/gift context

  // Warrant upload for digital arrest
  const [warrantFile, setWarrantFile] = useState(null);
  const [searchableInfo, setSearchableInfo] = useState(''); // police station, court name, etc.
  const [warrantResult, setWarrantResult] = useState('');
  const [loadingWarrant, setLoadingWarrant] = useState(false);

  // NEW: QR code upload for UPI
  const [qrFile, setQrFile] = useState(null);
  const [qrResult, setQrResult] = useState('');
  const [loadingQR, setLoadingQR] = useState(false);

  // Bait mode state
  const [scammerMsg, setScammerMsg] = useState('');
  const [conversation, setConversation] = useState([]); // {sender, msg}
  const [loadingBait, setLoadingBait] = useState(false);

  // Shared intel (Protect + Bait)
  const [intel, setIntel] = useState({
    upi_ids: [],
    phone_numbers: [],
    links: [],
    bank_accounts: [],
  });

  // ---------- SHARED INTEL EXTRACTOR ----------
  const addIntelFromText = (text) => {
    if (!text) return;

    const upiMatches = text.match(/\b[\w.-]+@\w+\b/g) || [];
    const phoneMatches = text.match(/\+?91?\d{10}\b/g) || [];
    const linkMatches = text.match(/https?:\/\/[^\s"]+/g) || [];
    const acctMatches = text.match(/\b\d{9,18}\b/g) || [];

    setIntel((prev) => ({
      upi_ids: Array.from(new Set([...prev.upi_ids, ...upiMatches])),
      phone_numbers: Array.from(
        new Set([...prev.phone_numbers, ...phoneMatches])
      ),
      links: Array.from(new Set([...prev.links, ...linkMatches])),
      bank_accounts: Array.from(
        new Set([...prev.bank_accounts, ...acctMatches])
      ),
    }));
  };

  // ---------- ACCOUNT / MULE CONTEXT ANALYZER ----------
  const analyzeAccountContext = (rawText) => {
    if (!rawText) return { risk: 'low', reason: '', flags: [] };

    const text = rawText.toLowerCase();

    const accountMatches = rawText.match(/\b\d{9,18}\b/g) || [];
    const ifscMatches = rawText.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi) || [];

    const flagWords = [
      'gift account',
      'gift wallet',
      'temporary account',
      'verification account',
      'settlement account',
      'gateway account',
      'refund account',
      'promo account',
      'offer account',
      'test account',
      'security account',
    ];

    const hitFlags = flagWords.filter((w) => text.includes(w));

    let risk = 'low';
    let reasonParts = [];

    if (accountMatches.length) {
      reasonParts.push(
        'Bare bank account number detected; this app cannot see owner name, account type or when it was opened.'
      );
    }

    if (ifscMatches.length) {
      reasonParts.push(
        'IFSC code present, which usually indicates a direct bank transfer request.'
      );
    }

    if (hitFlags.length) {
      risk = 'high';
      reasonParts.push(
        `Suspicious wording found: ${hitFlags.join(', ')}. Scammers often use such terms for mule / pass‑through accounts.`
      );
    } else if (accountMatches.length) {
      risk = 'medium';
    }

    if (!accountMatches.length && !hitFlags.length) {
      return { risk: 'low', reason: '', flags: [] };
    }

    reasonParts.push(
      'Treat this as an unknown beneficiary and confirm independently with your own bank or cyber helpline 1930 before any transfer.'
    );

    return {
      risk,
      reason: reasonParts.join(' '),
      flags: hitFlags,
      accounts: accountMatches,
      ifsc: ifscMatches,
    };
  };

  // ---------- PROTECT MODE PROMPT ----------
  const buildProtectPrompt = () => {
    if (caseType === 'upi') {
      if (lang === 'hi') {
        return `
यह UPI ID है या पेमेंट का detail है: "${protectInput}".

तथ्य:
- आपके पास बैंक या NPCI का रियल टाइम डेटा नहीं है।
- आप केवल फॉर्मेट, पैटर्न और मैसेज के शब्द देखकर जोखिम बता सकते हैं।
- आप 100% नहीं बता सकते कि यह असली है या नकली, या खाता किस टाइप का है / कब खोला गया।

काम:
1. UPI फॉर्मेट और handle (जैसे @paytm, @oksbi, @okaxis) को देखें।
2. टेक्स्ट में अगर "gift account, verification account, settlement account, refund account, security account" जैसे शब्द हों तो HIGH RISK मानें।
3. HIGH / MEDIUM / LOW risk में से एक चुनें।
4. 1–2 साधारण हिन्दी लाइनों में बताएँ कि यह risk level क्यों है।
5. हमेशा चेतावनी शामिल करें: "पैसे भेजने से पहले 1930 या बैंक से बात कर के ही भरोसा करें।"

केवल छोटा हिन्दी जवाब दें।
`;
      } else if (lang === 'mr') {
        return `
ही UPI ID किंवा पेमेंटची माहिती आहे: "${protectInput}".

तथ्य:
- तुमच्याकडे बँक / NPCI चे real‑time data नाही.
- तुम्ही फक्त फॉर्मॅट, pattern आणि मजकूरातील शब्द पाहून रिस्क सांगू शकता.
- खाते personal / company / gift आहे का, किंवा केव्हा उघडले हे सांगू शकत नाही.

काम:
1. UPI फॉर्मॅट आणि handle (उदा. @paytm, @oksbi, @okaxis) पाहा.
2. "gift account, verification account, settlement account, refund account, security account" असे शब्द आढळले तर HIGH RISK धरा.
3. HIGH / MEDIUM / LOW यापैकी रिस्क द्या.
4. 1–2 साध्या मराठी ओळींत कारण सांगा.
5. शेवटी नेहमी चेतावणी द्या: "पैसे पाठवण्यापूर्वी 1930 किंवा बँकेशी बोलून खात्री करा."

फक्त छोटा मराठी मेसेज द्या.
`;
      } else {
        return `
This is a UPI ID or payment detail: "${protectInput}".

Facts:
- You do NOT have live bank/NPCI data.
- You can only judge by format, pattern and the wording in the message.
- You CANNOT see who owns the account, what type it is, or when it was opened.

Task:
1. Look at UPI format and handle (e.g. @paytm, @oksbi, @okaxis).
2. If the text contains phrases like "gift account, verification account, settlement account, refund account, security account", treat as HIGH RISK.
3. Decide risk: HIGH / MEDIUM / LOW.
4. In 1–2 simple English lines, explain why.
5. Always add: "Do not send money just based on messages/calls. Confirm with your bank or 1930 first."

Output only that short English message.
`;
      }
    } else {
      if (lang === 'hi') {
        return `
यह WhatsApp / कॉल का संदेश है:

"${protectInput}"

आपको DIGITAL ARREST scam पहचानना है, जहाँ धोखेबाज़ खुद को Police / CBI / Cyber Cell / FedEx / Customs बताते हैं और कहते हैं कि:
- कोई parcel पकड़ा गया है,
- पैसा laundering हो रहा है,
- arrest warrant है,
- KYC / Aadhaar में दिक्कत है,
और फिर victim को लम्बे video call पर रखते हैं और "security money" UPI से मँगवाते हैं।

काम:
1. HIGH / MEDIUM / LOW risk तय करें।
2. 1–2 लाइन साधारण हिन्दी में बताएं कि यह डिजिटल arrest scam जैसा क्यों लग रहा है (या नहीं)।
3. हमेशा चेतावनी दें: "ऐसे कॉल / वीडियो कॉल पर भरोसा न करें, खुद अपने स्थानीय थाना या 1930 पर कॉल कर के ही confirm करें।"

सिर्फ छोटा हिन्दी जवाब दें, extra explanation नहीं।
`;
      } else if (lang === 'mr') {
        return `
हा WhatsApp / कॉल मेसेज आहे:

"${protectInput}"

तुम्हाला DIGITAL ARREST scam ओळखायचा आहे, जिथे फसवे लोक स्वतःला Police / CBI / Cyber Cell / FedEx / Customs सांगतात आणि:
- parcel अडकलाय,
- money laundering,
- warrant,
- KYC समस्या,
असे बोलून व्हिक्टीमकडून UPI ने "security money" घेतात.

काम:
1. HIGH / MEDIUM / LOW रिस्क ठरवा.
2. 1–2 ओळींत साध्या मराठीत लिहा की हे डिजिटल arrest scam सारखे का वाटते (किंवा नाही).
3. नेहमी चेतावणी द्या: "अशा कॉल वर विश्वास ठेवू नका, स्वतः पोलीस स्टेशन किंवा 1930 वर फोन करून खात्री करा."

फक्त छोटा मराठी मेसेज द्या.
`;
      } else {
        return `
This is a WhatsApp / call script:

"${protectInput}"

You must detect DIGITAL ARREST scams in India, where fraudsters pretend to be Police/CBI/ED/Cyber Cell/FedEx/Customs, claim:
- A parcel is seized,
- Money laundering,
- An arrest warrant,
- KYC/Aadhaar problem,
and then keep the victim on video call and demand "security money" via UPI/bank.

Task:
1. Decide risk: HIGH / MEDIUM / LOW.
2. In 1–2 short lines of simple English, say why this looks like (or doesn't look like) a digital arrest scam.
3. Always warn: "Do not trust such calls/video calls. Verify by calling your local police station or 1930 yourself."

Output only that short message.
`;
      }
    }
  };

  const scanProtect = async () => {
    if (!protectInput.trim()) {
      setProtectResult(
        lang === 'en'
          ? 'Please enter something to scan.'
          : lang === 'mr'
          ? 'कृपया तपासण्यासाठी मजकूर / UPI टाका.'
          : 'कृपया स्कैन के लिए टेक्स्ट / UPI डालें.'
      );
      setAccountRiskNote('');
      return;
    }

    setLoadingProtect(true);
    setProtectResult('');
    setAccountRiskNote('');

    try {
      addIntelFromText(protectInput);
      const acctCtx = analyzeAccountContext(protectInput);
      if (acctCtx.reason) {
        setAccountRiskNote(
          (lang === 'en'
            ? `Account‑context analysis (${acctCtx.risk.toUpperCase()} RISK): `
            : lang === 'mr'
            ? `Account संदर्भ विश्लेषण (${acctCtx.risk.toUpperCase()} RISK): `
            : `खाते संदर्भ विश्लेषण (${acctCtx.risk.toUpperCase()} RISK): `) +
            acctCtx.reason
        );
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
      const prompt = buildProtectPrompt();
      const res = await model.generateContent(prompt);
      setProtectResult(res.response.text());
    } catch (e) {
      console.error(e);
      const msg =
        lang === 'en'
          ? 'Error, please try again later.'
          : lang === 'mr'
          ? 'चूक झाली, नंतर पुन्हा प्रयत्न करा.'
          : 'कुछ गड़बड़ हो गयी, बाद में try करें.';
      setProtectResult(msg);
    } finally {
      setLoadingProtect(false);
    }
  };

  // ---------- WARRANT FILE UPLOAD & ANALYSIS ----------
  const analyseWarrant = async () => {
    if (!warrantFile) {
      setWarrantResult(
        lang === 'en'
          ? 'Please select a warrant file first.'
          : lang === 'mr'
          ? 'कृपया प्रथम warrant फाईल निवडा.'
          : 'कृपया पहले warrant फ़ाइल चुनें.'
      );
      return;
    }

    setLoadingWarrant(true);
    setWarrantResult('');

    try {
      const fd = new FormData();
      fd.append('file', warrantFile);
      fd.append('lang', lang);
      fd.append('searchableInfo', searchableInfo || '');

      const res = await fetch('http://localhost:5000/api/analyse-warrant', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        throw new Error('Backend error');
      }

      const data = await res.json();
      setWarrantResult(data.message || 'Analysis complete.');

      if (data.extracted_text) {
        addIntelFromText(data.extracted_text);
      }
      if (data.entities) {
        const {
          upi_ids = [],
          phone_numbers = [],
          accounts = [],
        } = data.entities;
        addIntelFromText(
          [
            ...upi_ids,
            ...phone_numbers,
            ...accounts,
          ].join(' ')
        );
      }
    } catch (e) {
      console.error(e);
      const msg =
        lang === 'en'
          ? 'Error analyzing warrant. Please try again later.'
          : lang === 'mr'
          ? 'Warrant विश्लेषणात चूक. नंतर पुन्हा प्रयत्न करा.'
          : 'Warrant analyse करने में गड़बड़ हुई, बाद में try करें.';
      setWarrantResult(msg);
    } finally {
      setLoadingWarrant(false);
    }
  };

  // ---------- NEW: QR CODE ANALYSIS ----------
  const analyseQR = async () => {
    if (!qrFile) {
      setQrResult(
        lang === 'en'
          ? 'Please select a QR code image first.'
          : lang === 'mr'
          ? 'कृपया प्रथम QR code image निवडा.'
          : 'कृपया पहले QR code image चुनें.'
      );
      return;
    }

    setLoadingQR(true);
    setQrResult('');

    try {
      const fd = new FormData();
      fd.append('file', qrFile);
      fd.append('lang', lang);

      const res = await fetch('http://localhost:5000/api/analyse-qr', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        throw new Error('Backend error');
      }

      const data = await res.json();
      
      if (data.qr_decoded) {
        setQrResult(data.message || 'QR analysis complete.');
        
        // Add extracted UPI ID to intel
        if (data.upi_id && data.upi_id !== 'Not found') {
          addIntelFromText(data.upi_id);
        }
      } else {
        setQrResult(data.message || 'Could not decode QR code.');
      }
    } catch (e) {
      console.error(e);
      const msg =
        lang === 'en'
          ? 'Error analyzing QR code. Please try again later.'
          : lang === 'mr'
          ? 'QR code विश्लेषणात चूक. नंतर पुन्हा प्रयत्न करा.'
          : 'QR code analyse करने में गड़बड़ हुई, बाद में try करें.';
      setQrResult(msg);
    } finally {
      setLoadingQR(false);
    }
  };

  // ---------- BAIT MODE (RAMESH UNCLE) ----------
  const buildBaitPrompt = () => `
You are "Ramesh Uncle", a 68-year-old retired bank officer from Mumbai.
You speak simple Hindi-English mix, are curious but confused about UPI and apps.
Your job is:
- Keep the scammer engaged.
- Extract their payment and contact details.
- NEVER send money or share any real personal data.

Use short, 1–2 sentence replies, like an elderly uncle:
- "Okk beta, thoda dheere samjhao."
- "Mera phone hang ho gaya, firse bhejo."

Return ONLY valid JSON:

{
  "reply_to_scammer": "your message as Ramesh Uncle",
  "extracted_intel": {
    "upi_ids": ["..."],
    "phone_numbers": ["..."],
    "links": ["..."],
    "bank_accounts": ["..."]
  },
  "confidence_scam": "low | medium | high",
  "notes_for_law_enforcement": "1–2 short lines explaining why this looks like a scam and what intel you saw."
}

If some field is empty, use [].

Scammer message: "${scammerMsg}"
`;

  const sendBait = async () => {
    if (!scammerMsg.trim()) return;

    setLoadingBait(true);

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
      const prompt = buildBaitPrompt();
      const res = await model.generateContent(prompt);
      let text = res.response.text().trim();

      if (text.startsWith('```')) {
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      }

      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        obj = {
          reply_to_scammer: text,
          extracted_intel: {
            upi_ids: [],
            phone_numbers: [],
            links: [],
            bank_accounts: [],
          },
        };
      }

      setConversation((prev) => [
        ...prev,
        { sender: 'Scammer', msg: scammerMsg },
        { sender: 'Ramesh Uncle (AI)', msg: obj.reply_to_scammer || text },
      ]);

      if (obj.extracted_intel) {
        addIntelFromText(
          [
            scammerMsg,
            ...(obj.extracted_intel.upi_ids || []),
            ...(obj.extracted_intel.phone_numbers || []),
            ...(obj.extracted_intel.links || []),
            ...(obj.extracted_intel.bank_accounts || []),
          ].join(' ')
        );
      }

      setScammerMsg('');
    } catch (e) {
      console.error(e);
      alert('Error talking as Ramesh Uncle, कृपया बाद में try करें.');
    } finally {
      setLoadingBait(false);
    }
  };

  // ---------- REPORT BUILDER ----------
  const buildReportText = () => {
    const lines = [];
    lines.push('ElderGuard Scam Report');
    lines.push('----------------------');
    lines.push('UPI IDs: ' + (intel.upi_ids.join(', ') || 'None'));
    lines.push('Phones: ' + (intel.phone_numbers.join(', ') || 'None'));
    lines.push('Links: ' + (intel.links.join(', ') || 'None'));
    lines.push('Bank Accounts / Numbers: ' + (intel.bank_accounts.join(', ') || 'None'));
    lines.push('');
    if (accountRiskNote) {
      lines.push('Local account‑risk note: ' + accountRiskNote);
      lines.push('');
    }
    if (warrantResult) {
      lines.push('Warrant analysis: ' + warrantResult);
      lines.push('');
    }
    if (qrResult) {
      lines.push('QR code analysis: ' + qrResult);
      lines.push('');
    }
    lines.push('Conversation:');
    conversation.forEach((m) => lines.push(`${m.sender}: ${m.msg}`));
    return lines.join('\n');
  };

  const copyReport = () => {
    const text = buildReportText();
    navigator.clipboard
      .writeText(text)
      .then(() => alert('Report copied. Paste into 1930 / cybercrime.gov.in form.'))
      .catch(() => alert('Could not copy, please select & copy manually.'));
  };

  // ---------- UPI HANDLE INFO ----------
  const currentUpiHandleInfo = () => {
    const match = protectInput.match(/@([\w]+)/);
    if (!match) return null;
    const handle = match.toLowerCase();[8]
    return KNOWN_UPI_HANDLES[handle] || null;
  };

  const upiInfo = currentUpiHandleInfo();

  // ---------- RENDER ----------
  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: 26, marginBottom: 8 }}>🛡️ ElderGuard 2.3</h1>

      {/* Mode toggle */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setMode('protect')}
          style={{
            fontSize: 16,
            padding: '6px 12px',
            marginRight: 8,
            backgroundColor: mode === 'protect' ? '#28a745' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          🛡️ Protect Mode
        </button>
        <button
          onClick={() => setMode('bait')}
          style={{
            fontSize: 16,
            padding: '6px 12px',
            backgroundColor: mode === 'bait' ? '#ff8800' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          🎣 Bait Mode (Let AI Handle)
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* LEFT: main interaction */}
        <div style={{ flex: 2 }}>
          {mode === 'protect' ? (
            <>
              {/* Language selector */}
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 18, marginRight: 8 }}>Output language:</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  style={{ fontSize: 18, padding: 4 }}
                >
                  <option value="hi">हिन्दी</option>
                  <option value="mr">मराठी</option>
                  <option value="en">English</option>
                </select>
              </div>

              {/* Case type toggle */}
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 18, marginRight: 8 }}>What to scan:</span>
                <button
                  onClick={() => setCaseType('upi')}
                  style={{
                    fontSize: 14,
                    padding: '4px 8px',
                    marginRight: 4,
                    backgroundColor:
                      caseType === 'upi' ? '#28a745' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  UPI / Investment / Account / QR
                </button>
                <button
                  onClick={() => setCaseType('digital')}
                  style={{
                    fontSize: 14,
                    padding: '4px 8px',
                    backgroundColor:
                      caseType === 'digital' ? '#17a2b8' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Digital Arrest Text / Warrant
                </button>
              </div>

              {caseType === 'upi' ? (
                <>
                  <label style={{ fontSize: 20 }}>
                    {lang === 'en'
                      ? 'Enter UPI ID / account detail text:'
                      : lang === 'mr'
                      ? 'UPI ID / खातेचा मजकूर टाका:'
                      : 'UPI ID / खाते वाला टेक्स्ट डालें:'}
                    <br />
                    <textarea
                      style={{
                        marginTop: 8,
                        fontSize: 18,
                        padding: 8,
                        width: '100%',
                        minHeight: 80,
                        boxSizing: 'border-box',
                      }}
                      placeholder={
                        lang === 'en'
                          ? 'Example: Send 10,000 to abcd9876@okaxis gift account, A/C 123456789012 IFSC HDFC0001234'
                          : lang === 'mr'
                          ? 'उदा: १०,००० gift account ला पाठवा, UPI abcd9876@okaxis, A/C 123456789012, IFSC HDFC0001234'
                          : 'जैसे: 10,000 gift account में भेजो, UPI abcd9876@okaxis, A/C 123456789012, IFSC HDFC0001234'
                      }
                      value={protectInput}
                      onChange={(e) => setProtectInput(e.target.value)}
                    />
                  </label>

                  <br />
                  <br />

                  <button
                    onClick={scanProtect}
                    disabled={loadingProtect}
                    style={{
                      fontSize: 20,
                      padding: '10px 18px',
                      cursor: loadingProtect ? 'not-allowed' : 'pointer',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                    }}
                  >
                    {loadingProtect
                      ? lang === 'en'
                        ? 'Checking…'
                        : lang === 'mr'
                        ? 'तपास चालू आहे…'
                        : 'जांच हो रही है…'
                      : lang === 'en'
                      ? 'Scan Text'
                      : lang === 'mr'
                      ? 'मजकूर स्कॅन करा'
                      : 'टेक्स्ट स्कैन करें'}
                  </button>

                  <br />
                  <br />

                  {upiInfo && (
                    <div
                      style={{
                        fontSize: 14,
                        padding: 8,
                        borderRadius: 6,
                        backgroundColor: '#e2e3e5',
                        border: '1px solid #d6d8db',
                        marginBottom: 8,
                      }}
                    >
                      <strong>UPI handle info:</strong> {upiInfo.psp} —{' '}
                      {upiInfo.note}{' '}
                      (App cannot see actual account type / opening date; only your bank and regulators can.)
                    </div>
                  )}

                  {accountRiskNote && (
                    <div
                      style={{
                        fontSize: 15,
                        padding: 10,
                        borderRadius: 6,
                        backgroundColor: '#f8d7da',
                        border: '1px solid #f5c6cb',
                        whiteSpace: 'pre-wrap',
                        marginBottom: 8,
                      }}
                    >
                      {accountRiskNote}
                    </div>
                  )}

                  {protectResult && (
                    <div
                      style={{
                        fontSize: 18,
                        padding: 12,
                        borderRadius: 6,
                        backgroundColor: '#fff3cd',
                        border: '1px solid #ffeeba',
                        whiteSpace: 'pre-wrap',
                        marginBottom: 16,
                      }}
                    >
                      {protectResult}
                    </div>
                  )}

                  <hr style={{ margin: '20px 0' }} />

                  {/* NEW: QR CODE UPLOAD SECTION */}
                  <h3 style={{ fontSize: 20, marginBottom: 8 }}>
                    📷{' '}
                    {lang === 'en'
                      ? 'Upload UPI QR Code Image'
                      : lang === 'mr'
                      ? 'UPI QR Code Image अपलोड करा'
                      : 'UPI QR Code Image अपलोड करें'}
                  </h3>

                  <div
                    style={{
                      fontSize: 14,
                      padding: 8,
                      backgroundColor: '#f0f0f0',
                      border: '1px solid #ccc',
                      borderRadius: 6,
                      marginBottom: 12,
                    }}
                  >
                    {lang === 'en'
                      ? 'We decode the QR code and analyze visual tampering signs (overlays, pixel artifacts). We cannot verify the actual account holder; always confirm with the merchant directly.'
                      : lang === 'mr'
                      ? 'आम्ही QR code decode करतो आणि visual tampering (overlay, pixel artifacts) चे विश्लेषण करतो. आम्ही account holder verify करू शकत नाही; नेहमी merchant शी थेट खात्री करा.'
                      : 'हम QR code decode करते हैं और visual tampering (overlay, pixel artifacts) का analysis करते हैं। हम account holder verify नहीं कर सकते; हमेशा merchant से सीधे confirm करें।'}
                  </div>

                  <label style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                    {lang === 'en'
                      ? 'Select QR code image (PNG, JPG):'
                      : lang === 'mr'
                      ? 'QR code image निवडा (PNG, JPG):'
                      : 'QR code image चुनें (PNG, JPG):'}
                    <br />
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={(e) => setQrFile(e.target.files?.[0] || null)}
                      style={{ marginTop: 6, fontSize: 16 }}
                    />
                  </label>

                  {qrFile && (
                    <div style={{ fontSize: 14, marginBottom: 8, color: '#555' }}>
                      {lang === 'en' ? 'Selected: ' : lang === 'mr' ? 'निवडलेले: ' : 'चुना हुआ: '}
                      <strong>{qrFile.name}</strong>
                    </div>
                  )}

                  <button
                    onClick={analyseQR}
                    disabled={loadingQR}
                    style={{
                      fontSize: 18,
                      padding: '8px 14px',
                      cursor: loadingQR ? 'not-allowed' : 'pointer',
                      backgroundColor: '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      marginBottom: 12,
                    }}
                  >
                    {loadingQR
                      ? lang === 'en'
                        ? 'Analyzing QR…'
                        : lang === 'mr'
                        ? 'QR तपासणी चालू…'
                        : 'QR जांच हो रही है…'
                      : lang === 'en'
                      ? 'Analyze QR Code'
                      : lang === 'mr'
                      ? 'QR Code तपासा'
                      : 'QR Code जांचें'}
                  </button>

                  {qrResult && (
                    <div
                      style={{
                        fontSize: 16,
                        padding: 12,
                        borderRadius: 6,
                        backgroundColor: '#d1ecf1',
                        border: '1px solid #bee5eb',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {qrResult}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Digital Arrest Text option */}
                  <label style={{ fontSize: 20 }}>
                    {lang === 'en'
                      ? 'Paste call / WhatsApp message:'
                      : lang === 'mr'
                      ? 'कॉल / WhatsApp मेसेज इथे पेस्ट करा:'
                      : 'कॉल / WhatsApp संदेश यहाँ पेस्ट करें:'}
                    <br />
                    <textarea
                      style={{
                        marginTop: 8,
                        fontSize: 18,
                        padding: 8,
                        width: '100%',
                        minHeight: 80,
                        boxSizing: 'border-box',
                      }}
                      placeholder={
                        lang === 'en'
                          ? 'e.g. "This is CBI, join video call or we arrest you"'
                          : lang === 'mr'
                          ? 'उदा. "मी पोलिस बोलतोय, लगेच व्हिडिओ कॉलला या"'
                          : 'जैसे: "मैं CBI से बोल रहा हूँ, तुरंत वीडियो कॉल पर आओ"'
                      }
                      value={protectInput}
                      onChange={(e) => setProtectInput(e.target.value)}
                    />
                  </label>

                  <br />

                  <button
                    onClick={scanProtect}
                    disabled={loadingProtect}
                    style={{
                      fontSize: 18,
                      padding: '8px 14px',
                      cursor: loadingProtect ? 'not-allowed' : 'pointer',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      marginBottom: 12,
                    }}
                  >
                    {loadingProtect
                      ? lang === 'en'
                        ? 'Checking…'
                        : lang === 'mr'
                        ? 'तपास चालू आहे…'
                        : 'जांच हो रही है…'
                      : lang === 'en'
                      ? 'Scan Text'
                      : lang === 'mr'
                      ? 'मजकूर स्कॅन करा'
                      : 'टेक्स्ट स्कैन करें'}
                  </button>

                  {protectResult && (
                    <div
                      style={{
                        fontSize: 18,
                        padding: 12,
                        borderRadius: 6,
                        backgroundColor: '#fff3cd',
                        border: '1px solid #ffeeba',
                        whiteSpace: 'pre-wrap',
                        marginBottom: 16,
                      }}
                    >
                      {protectResult}
                    </div>
                  )}

                  <hr style={{ margin: '20px 0' }} />

                  {/* Warrant file upload section */}
                  <h3 style={{ fontSize: 20, marginBottom: 8 }}>
                    📄{' '}
                    {lang === 'en'
                      ? 'Upload Warrant / Notice for Analysis'
                      : lang === 'mr'
                      ? 'Warrant / Notice अपलोड करा'
                      : 'Warrant / Notice अपलोड करें'}
                  </h3>

                  <div
                    style={{
                      fontSize: 14,
                      padding: 8,
                      backgroundColor: '#f0f0f0',
                      border: '1px solid #ccc',
                      borderRadius: 6,
                      marginBottom: 12,
                    }}
                  >
                    {lang === 'en'
                      ? 'We analyze document style, letterhead quality, spelling, and any suspicious demands (UPI payment, video call threats). We do NOT check any police/court database; real confirmation must be done by calling your local police or 1930.'
                      : lang === 'mr'
                      ? 'आम्ही दस्तऐवजाची शैली, लेटरहेडची गुणवत्ता, spelling आणि संशयास्पद मागण्या (UPI payment, video call धमकी) यांचे विश्लेषण करतो. आम्ही police/court database तपासत नाही; खरी पडताळणी फक्त तुमच्या स्थानिक पोलीस स्टेशन किंवा 1930 वर कॉल करून करायची.'
                      : 'हम document की style, letterhead quality, spelling और संदिग्ध मांगें (UPI payment, video call धमकी) check करते हैं। हम किसी police/court database को check नहीं करते; असली verification केवल अपने local police station या 1930 से call करके करें।'}
                  </div>

                  <label style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                    {lang === 'en'
                      ? 'Select warrant file (PDF, Image, Doc):'
                      : lang === 'mr'
                      ? 'Warrant फाईल निवडा (PDF, चित्र, Doc):'
                      : 'Warrant फ़ाइल चुनें (PDF, Image, Doc):'}
                    <br />
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                      onChange={(e) => setWarrantFile(e.target.files?.[0] || null)}
                      style={{ marginTop: 6, fontSize: 16 }}
                    />
                  </label>

                  {warrantFile && (
                    <div style={{ fontSize: 14, marginBottom: 8, color: '#555' }}>
                      {lang === 'en' ? 'Selected: ' : lang === 'mr' ? 'निवडलेले: ' : 'चुना हुआ: '}
                      <strong>{warrantFile.name}</strong>
                    </div>
                  )}

                  <label style={{ fontSize: 16, display: 'block', marginBottom: 12 }}>
                    {lang === 'en'
                      ? 'Optional: Enter police station, court name, or anything searchable online to cross‑check:'
                      : lang === 'mr'
                      ? 'पर्यायी: पोलीस स्टेशन, court नाव किंवा ऑनलाइन शोधण्यायोग्य काहीही टाका:'
                      : 'Optional: police station, court का नाम या online search के लिए कुछ भी लिखें:'}
                    <br />
                    <input
                      type="text"
                      style={{
                        marginTop: 6,
                        fontSize: 16,
                        padding: 6,
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                      placeholder={
                        lang === 'en'
                          ? 'e.g. "Mumbai Cyber Police Station", "Andheri Court"'
                          : lang === 'mr'
                          ? 'उदा. "Mumbai Cyber Police Station", "Andheri Court"'
                          : 'जैसे: "Mumbai Cyber Police Station", "Andheri Court"'
                      }
                      value={searchableInfo}
                      onChange={(e) => setSearchableInfo(e.target.value)}
                    />
                  </label>

                  <button
                    onClick={analyseWarrant}
                    disabled={loadingWarrant}
                    style={{
                      fontSize: 18,
                      padding: '8px 14px',
                      cursor: loadingWarrant ? 'not-allowed' : 'pointer',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                    }}
                  >
                    {loadingWarrant
                      ? lang === 'en'
                        ? 'Analyzing…'
                        : lang === 'mr'
                        ? 'विश्लेषण चालू आहे…'
                        : 'विश्लेषण हो रहा है…'
                      : lang === 'en'
                      ? 'Analyze Warrant'
                      : lang === 'mr'
                      ? 'Warrant तपासा'
                      : 'Warrant जांचें'}
                  </button>

                  <br />
                  <br />

                  {warrantResult && (
                    <div
                      style={{
                        fontSize: 16,
                        padding: 12,
                        borderRadius: 6,
                        backgroundColor: '#f8d7da',
                        border: '1px solid #f5c6cb',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {warrantResult}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 20 }}>🎣 Ramesh Uncle Chat</h2>
              <div
                style={{
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  padding: 8,
                  minHeight: 200,
                  maxHeight: 350,
                  overflowY: 'auto',
                  backgroundColor: '#f9f9f9',
                }}
              >
                {conversation.length === 0 && (
                  <div style={{ color: '#777' }}>
                    Paste scammer message below and click "Reply as Ramesh Uncle".
                  </div>
                )}
                {conversation.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      margin: '6px 0',
                      textAlign: m.sender === 'Scammer' ? 'left' : 'right',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-block',
                        padding: '6px 10px',
                        borderRadius: 12,
                        backgroundColor:
                          m.sender === 'Scammer' ? '#e0e0e0' : '#d1ecf1',
                      }}
                    >
                      <strong>{m.sender}:</strong> {m.msg}
                    </div>
                  </div>
                ))}
              </div>

              <textarea
                style={{
                  marginTop: 8,
                  width: '100%',
                  minHeight: 70,
                  fontSize: 16,
                  padding: 8,
                  boxSizing: 'border-box',
                }}
                placeholder="Paste scammer's latest message here..."
                value={scammerMsg}
                onChange={(e) => setScammerMsg(e.target.value)}
              />

              <button
                onClick={sendBait}
                disabled={loadingBait}
                style={{
                  marginTop: 8,
                  fontSize: 18,
                  padding: '8px 14px',
                  backgroundColor: '#ff8800',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: loadingBait ? 'not-allowed' : 'pointer',
                }}
              >
                {loadingBait ? 'AI सोच रहा है…' : 'Reply as Ramesh Uncle'}
              </button>
            </>
          )}
        </div>

        {/* RIGHT: Intel + report (shared) */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20 }}>📊 Extracted Intel</h2>
          <div
            style={{
              border: '1px solid #ccc',
              borderRadius: 6,
              padding: 8,
              fontSize: 14,
              maxHeight: 400,
              overflowY: 'auto',
            }}
          >
            <p>
              <strong>UPI IDs:</strong>{' '}
              {intel.upi_ids.length ? intel.upi_ids.join(', ') : 'None yet'}
            </p>
            <p>
              <strong>Phones:</strong>{' '}
              {intel.phone_numbers.length
                ? intel.phone_numbers.join(', ')
                : 'None yet'}
            </p>
            <p>
              <strong>Links:</strong>{' '}
              {intel.links.length ? intel.links.join(', ') : 'None yet'}
            </p>
            <p>
              <strong>Bank Accounts / Numbers:</strong>{' '}
              {intel.bank_accounts.length
                ? intel.bank_accounts.join(', ')
                : 'None yet'}
            </p>
          </div>

          <button
            onClick={copyReport}
            style={{
              marginTop: 10,
              fontSize: 16,
              padding: '8px 14px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            📋 Copy report for 1930
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
