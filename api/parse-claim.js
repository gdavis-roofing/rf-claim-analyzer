import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.status(400).json({ error: 'No PDF data provided' });
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Read this insurance claim PDF and extract ALL line items. Return ONLY valid JSON — no preamble, no markdown fences, no explanation.\n\nJSON structure:\n{\n  "carrier": "string",\n  "policyType": "RCV",\n  "hasOP": false,\n  "opTotal": 0,\n  "summaryRCV": 0,\n  "summaryRecDep": 0,\n  "summaryNonRecDep": 0,\n  "summaryACV": 0,\n  "summaryDeductible": 0,\n  "summaryNetClaim": 0,\n  "taxRate": 0,\n  "taxMethod": "summary",\n  "taxAmount": 0,\n  "customerName": "string",\n  "propertyAddress": "string",\n  "claimNumber": "string",\n  "deductible": 0,\n  "lineItems": [{"lineNumber":1,"description":"string","quantity":"1.00 EA","rcv":0,"recoverableDep":0,"nonRecoverableDep":0,"acv":0}]\n}\n\nRules: Include every line item. Dollar amounts as plain numbers. Read summary values from the printed summary page. For taxRate: extract the sales tax percentage from the summary page (e.g. "9.500%" → 9.5); set taxMethod to "summary" if tax is applied as a bulk line at the summary level, otherwise "line_item"; set taxAmount to the total tax dollar amount. Return ONLY the JSON object.' }
      ]}]
    });
    const raw = response.content[0].text;
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) return res.status(500).json({ error: 'Failed to parse AI response as JSON', raw });
    const parsed = JSON.parse(raw.slice(first, last + 1));
    const pwiItems = parsed.lineItems?.filter(i => i.paidWhenIncurred) || [];
    console.log("PWI items found:", pwiItems.length, pwiItems.map(i => i.description));
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
