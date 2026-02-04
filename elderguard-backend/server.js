// server.js
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const sharp = require('sharp');

const app = express();
const PORT = 5000;

// Enable CORS for your React app
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Set up multer for file uploads (10 MB limit)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// TODO: Replace with your actual Gemini API key
const genAI = new GoogleGenerativeAI('YOUR_API_KEY_HERE');
// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'ElderGuard backend is running' });
});

// Warrant analysis endpoint
app.post('/api/analyse-warrant', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { lang = 'en', searchableInfo = '' } = req.body;

    console.log('Analyzing file:', req.file.originalname);
    console.log('Language:', lang);
    console.log('Searchable info:', searchableInfo);

    // Read the file as base64
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64Data = fileBuffer.toString('base64');

    // Determine mimeType based on file extension
    let mimeType = 'application/octet-stream';
    if (req.file.mimetype) {
      mimeType = req.file.mimetype;
    } else if (req.file.originalname.endsWith('.pdf')) {
      mimeType = 'application/pdf';
    } else if (req.file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      mimeType = `image/${ext}`;
    }

    console.log('MIME type:', mimeType);

    // Build the prompt
    const promptText = buildWarrantPrompt(lang, searchableInfo);

    // Call Gemini with multimodal input (image or PDF)
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const result = await model.generateContent([
      promptText,
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
    ]);

    const responseText = result.response.text();
    console.log('Gemini response:', responseText);

    // Try to parse JSON
    let parsed;
    try {
      const cleaned = responseText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.log('JSON parse failed, returning raw text');
      parsed = {
        risk: 'unknown',
        message: responseText,
        extracted_text: '',
        entities: {},
      };
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json(parsed);
  } catch (error) {
    console.error('Error analyzing warrant:', error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Server error analyzing warrant',
      details: error.message 
    });
  }
});

// NEW: QR code analysis endpoint
app.post('/api/analyse-qr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No QR code image uploaded' });
    }

    const { lang = 'en' } = req.body;

    console.log('Analyzing QR code:', req.file.originalname);

    const fileBuffer = fs.readFileSync(req.file.path);

    // Decode QR code
    let qrData = null;
    try {
      // Convert to PNG if needed
      const pngBuffer = await sharp(fileBuffer).png().toBuffer();
      const png = PNG.sync.read(pngBuffer);
      const imageData = {
        data: new Uint8ClampedArray(png.data),
        width: png.width,
        height: png.height,
      };
      
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        qrData = code.data;
        console.log('QR decoded:', qrData);
      }
    } catch (decodeError) {
      console.error('QR decode error:', decodeError);
    }

    if (!qrData) {
      fs.unlinkSync(req.file.path);
      return res.json({
        risk: 'unknown',
        message: lang === 'hi' 
          ? 'QR code नहीं पढ़ा जा सका। कृपया साफ़ image upload करें।'
          : lang === 'mr'
          ? 'QR code वाचता आला नाही. कृपया स्पष्ट image अपलोड करा.'
          : 'Could not decode QR code. Please upload a clear image.',
        qr_decoded: false,
      });
    }

    // Parse UPI data
    const upiData = parseUPIString(qrData);

    // Visual tampering analysis with Gemini
    const base64Data = fileBuffer.toString('base64');
    let mimeType = 'image/jpeg';
    if (req.file.originalname.match(/\.png$/i)) mimeType = 'image/png';
    else if (req.file.originalname.match(/\.webp$/i)) mimeType = 'image/webp';

    const visualPrompt = buildQRVisualPrompt(lang, qrData, upiData);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const result = await model.generateContent([
      visualPrompt,
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
    ]);

    const responseText = result.response.text();
    console.log('Gemini QR visual analysis:', responseText);

    // Build response
    const response = {
      qr_decoded: true,
      qr_raw_data: qrData,
      upi_id: upiData.pa || 'Not found',
      merchant_name: upiData.pn || 'Not found',
      amount: upiData.am || 'Not specified',
      transaction_note: upiData.tn || 'None',
      visual_analysis: responseText,
      risk: assessQRRisk(upiData, responseText),
      message: buildQRMessage(lang, upiData, responseText),
    };

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json(response);
  } catch (error) {
    console.error('Error analyzing QR:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Server error analyzing QR code',
      details: error.message 
    });
  }
});

// Helper: Parse UPI string
function parseUPIString(upiStr) {
  const data = {};
  if (!upiStr.startsWith('upi://')) return data;
  
  const params = upiStr.split('?')[1];
  if (!params) return data;
  
  params.split('&').forEach(param => {
    const [key, value] = param.split('=');
    data[key] = decodeURIComponent(value || '');
  });
  
  return data;
}

// Helper: Build QR visual analysis prompt
function buildQRVisualPrompt(lang, rawData, parsedData) {
  return `
You are analyzing a UPI QR code image for visual tampering signs.

QR decoded data: ${rawData}
UPI ID: ${parsedData.pa || 'unknown'}
Merchant: ${parsedData.pn || 'unknown'}

Task:
1. Look at the QR code image for signs of tampering: overlay sticker edges, pixel artifacts, mismatched text/logo around the QR, poor print quality, multiple layers visible.
2. Check if the merchant name/logo around the QR matches the decoded UPI ID handle.
3. Decide: NORMAL / SUSPICIOUS / HIGH_RISK.
4. In 2–3 short lines (${lang === 'hi' ? 'Hindi' : lang === 'mr' ? 'Marathi' : 'English'}), explain what you see.

Return only plain text (not JSON), no more than 3 sentences.
`;
}

// Helper: Assess QR risk
function assessQRRisk(upiData, visualAnalysis) {
  const vis = visualAnalysis.toLowerCase();
  if (vis.includes('high_risk') || vis.includes('suspicious') || vis.includes('tamper')) {
    return 'high';
  }
  if (!upiData.pa || upiData.pa.length < 5) {
    return 'high';
  }
  if (!upiData.pn || upiData.pn === 'unknown') {
    return 'medium';
  }
  return 'low';
}

// Helper: Build final QR message
function buildQRMessage(lang, upiData, visualAnalysis) {
  const upiId = upiData.pa || 'unknown';
  const merchant = upiData.pn || 'unknown';
  const amount = upiData.am || 'not specified';
  
  if (lang === 'hi') {
    return `QR से decode हुआ:\n- UPI ID: ${upiId}\n- Merchant: ${merchant}\n- Amount: ₹${amount}\n\nVisual check: ${visualAnalysis}\n\nसलाह: भुगतान करने से पहले merchant का नाम check करें और अपने bank या 1930 से confirm करें।`;
  } else if (lang === 'mr') {
    return `QR मधून decode झाले:\n- UPI ID: ${upiId}\n- Merchant: ${merchant}\n- Amount: ₹${amount}\n\nVisual तपासणी: ${visualAnalysis}\n\nसल्ला: पेमेंट करण्यापूर्वी merchant चे नाव तपासा आणि बँक किंवा 1930 शी खात्री करा।`;
  } else {
    return `QR decoded:\n- UPI ID: ${upiId}\n- Merchant: ${merchant}\n- Amount: ₹${amount}\n\nVisual check: ${visualAnalysis}\n\nAdvice: Verify merchant name matches display and confirm with bank or 1930 before paying.`;
  }
}

// Helper: Build warrant prompt
function buildWarrantPrompt(lang, searchableInfo) {
  const base = `
You are analyzing a document that may be a fake "digital arrest" warrant in India.

Facts:
- Scammers send fake police/court warrants with logos, seals, FIR numbers, and demand "security deposit" or "video call compliance".
- You CANNOT check any government or police database.
- You can ONLY analyze: letterhead quality, spelling, language mix, formatting, and any suspicious demands (UPI payment, video call, threats).

Document type: Police warrant, court notice, or legal document (image/PDF).

${
  searchableInfo
    ? `User provided this searchable info: "${searchableInfo}". If it looks odd or you can suggest a Google search to verify, mention that briefly.`
    : ''
}

Task:
1. Look at letterhead design, spelling, grammar, Hindi/English mix, generic addressee ("Dear customer"), missing case details, contact via WhatsApp/Telegram, demand for UPI "security deposit".
2. Decide risk: HIGH / MEDIUM / LOW that this is a scam document.
3. In 2–3 short lines (${
    lang === 'hi' 
      ? 'simple Hindi' 
      : lang === 'mr' 
      ? 'simple Marathi' 
      : 'simple English'
  }), explain why this looks suspicious (or legitimate).
4. Extract any visible text, names, FIR numbers, phone numbers, UPI IDs, or bank details you see in the document.
5. Always end with: "Final verification must be done only by local police or 1930; this app cannot see government records."

Return strict JSON (no extra text):
{
  "risk": "high | medium | low",
  "message": "explanation for the user in their language",
  "extracted_text": "full plain text from the document",
  "entities": {
    "names": [],
    "fir_numbers": [],
    "phone_numbers": [],
    "upi_ids": [],
    "accounts": [],
    "stations": []
  }
}
`;
  return base;
}

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`📁 Uploads folder: ./uploads/`);
});
