// invoiceAI.js — Anthropic API ile fatura okuma (PDF / görsel → yapılandırılmış JSON)
// Dosya asla diske yazılmaz; buffer bellekte işlenir ve yanıt dönünce bırakılır.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

// Katı JSON şeması — output_config.format ile garanti edilir
const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['satici', 'satici_vkn', 'alici', 'fatura_no', 'fatura_tarihi', 'para_birimi', 'kalemler', 'kdv_ozeti', 'toplam_net', 'toplam_kdv', 'toplam_brut', 'tevkifat_var', 'tevkifat_orani', 'tevkifat_tutari', 'tevkifat_sebebi', 'odenecek_tutar'],
  properties: {
    satici: { type: 'string', description: 'Satıcı unvanı' },
    satici_vkn: { type: ['string', 'null'], description: 'Satıcı VKN/TCKN (varsa)' },
    alici: { type: 'string', description: 'Alıcı unvanı' },
    fatura_no: { type: 'string' },
    fatura_tarihi: { type: 'string', description: 'YYYY-MM-DD formatında' },
    para_birimi: { type: 'string', description: 'TRY, USD, EUR...' },
    tevkifat_var: { type: 'boolean', description: 'KDV tevkifatı içeriyor mu (Fatura Tipi TEVKIFAT ise true)' },
    tevkifat_orani: { type: ['string', 'null'], description: 'Tevkifat oranı, "2/10" formatında (yoksa null)' },
    tevkifat_tutari: { type: ['number', 'null'], description: 'Hesaplanan KDV tevkifat tutarı, TL (yoksa null)' },
    tevkifat_sebebi: { type: ['string', 'null'], description: 'Tevkifat sebebi/kodu, örn "624-Yük Taşımacılığı Hizmeti" (yoksa null)' },
    odenecek_tutar: { type: ['number', 'null'], description: 'Satıcıya fiilen ödenecek tutar (Ödenecek Tutar satırı; tevkifat varsa brütten düşük)' },
    kalemler: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['aciklama', 'adet', 'birim_fiyat', 'net_tutar', 'kdv_orani'],
        properties: {
          aciklama: { type: 'string' },
          adet: { type: 'number' },
          birim_fiyat: { type: 'number' },
          net_tutar: { type: 'number', description: 'KDV hariç satır tutarı' },
          kdv_orani: { type: 'number', description: 'Yüzde: 0, 1, 10 veya 20' },
        },
      },
    },
    kdv_ozeti: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['oran', 'matrah', 'kdv'],
        properties: {
          oran: { type: 'number' },
          matrah: { type: 'number' },
          kdv: { type: 'number' },
        },
      },
    },
    toplam_net: { type: 'number' },
    toplam_kdv: { type: 'number' },
    toplam_brut: { type: 'number' },
  },
};

const PROMPT = `Bu bir Türk faturası (veya fişi). Belgedeki bilgileri dikkatle çıkar:
- Satıcı unvanı ve varsa VKN/TCKN
- Alıcı unvanı
- Fatura numarası ve tarihi (YYYY-MM-DD formatına çevir)
- Tüm satır kalemleri: açıklama, miktar, birim fiyat, KDV hariç net tutar, KDV oranı
- KDV özeti: her oran için matrah ve KDV tutarı
- Genel toplamlar: net (KDV hariç), toplam KDV, brüt (KDV dahil)

KDV Tevkifatı (önemli):
- Fatura Tipi "TEVKIFAT" ise veya "KDV Tevkifat", "Tevkifata Tabi", "X/10" gibi ifadeler varsa tevkifat_var=true.
- tevkifat_orani: "2/10", "5/10", "9/10" gibi. Genelde "KDV Tevkifat (%..)=..." veya "Tevkifat Oranı" satırında.
- tevkifat_tutari: "Hesaplanan KDV Tevkifat" satırındaki tutar (devlete sorumlu sıfatıyla ödenecek KDV).
- odenecek_tutar: "Ödenecek Tutar" satırı — satıcıya fiilen ödenen (tevkifat düşülmüş) tutar. Tevkifat yoksa Vergiler Dahil Toplam ile aynıdır.
- tevkifat_sebebi: "Tevkifat Sebebi" satırı (örn "624-Yük Taşımacılığı Hizmeti").
- Tevkifat yoksa: tevkifat_var=false, diğer tevkifat alanları null.

Kurallar:
- Tutarları sayı olarak ver (Türkçe formatı 1.234,56 → 1234.56 çevir).
- Satır tutarı KDV dahil verilmişse net tutarı hesapla.
- Okunamayan alan için mantıklı varsayım yap; fatura no okunamıyorsa boş string ver.
- Belge fatura değilse bile (fiş, makbuz, dekont) aynı yapıda çıkar.`;

class InvoiceAIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function parseInvoice(buffer, mimetype) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new InvoiceAIError('ANTHROPIC_API_KEY tanımlı değil — .env dosyasına ekleyin.', 500);
  }

  const client = new Anthropic();
  const data = buffer.toString('base64');

  const contentBlock = mimetype === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mimetype, data } };

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: INVOICE_SCHEMA } },
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: PROMPT }],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      throw new InvoiceAIError('AI servisi yoğun — lütfen biraz sonra tekrar deneyin.', 429);
    }
    if (e instanceof Anthropic.BadRequestError) {
      throw new InvoiceAIError('Dosya işlenemedi — bozuk PDF veya desteklenmeyen içerik olabilir.', 422);
    }
    if (e instanceof Anthropic.APIError) {
      throw new InvoiceAIError(`AI servisi hatası: ${e.message}`, 502);
    }
    throw e;
  }

  if (response.stop_reason === 'refusal') {
    throw new InvoiceAIError('AI bu belgeyi işlemeyi reddetti.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new InvoiceAIError('Fatura çok uzun — daha az sayfalı bir belge deneyin.', 422);
  }

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new InvoiceAIError('AI yanıtı boş döndü — belge okunamamış olabilir.', 422);
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new InvoiceAIError('AI yanıtı çözümlenemedi — lütfen tekrar deneyin.', 502);
  }
}

module.exports = { parseInvoice, InvoiceAIError };
