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
        { type: 'text', text: 'Read this insurance claim PDF and extract ALL line items. Return ONLY valid JSON — no preamble, no markdown fences, no explanation.\n\nJSON structure:\n{\n  "carrier": "string",\n  "policyType": "RCV",\n  "hasOP": false,\n  "opTotal": 0,\n  "summaryRCV": 0,\n  "summaryRecDep": 0,\n  "summaryNonRecDep": 0,\n  "summaryACV": 0,\n  "summaryDeductible": 0,\n  "summaryNetClaim": 0,\n  "summaryNetIfRecovered": 0,\n  "taxRate": 0,\n  "taxMethod": "summary",\n  "taxAmount": 0,\n  "customerName": "string",\n  "propertyAddress": "string",\n  "claimNumber": "string",\n  "deductible": 0,\n  "lineItems": [{"lineNumber":1,"description":"string","quantity":"1.00 EA","rcv":0,"recoverableDep":0,"nonRecoverableDep":0,"acv":0,"paidWhenIncurred":true,"section":"string"}]\n}\n\nRules: Include every line item. Dollar amounts as plain numbers. Read summary values from the printed summary page. For taxRate: extract the sales tax percentage from the summary page (e.g. "9.500%" = 9.5); set taxMethod to "summary" if tax is applied as a bulk line at the summary level, otherwise "line_item"; set taxAmount to the total tax dollar amount. For summaryNetIfRecovered: find the "Net Estimate if Depreciation Is Recovered" or equivalent total on the summary page. For propertyAddress: extract the physical loss/property location address. Check these in order: (1) Look for "Loss Location:" on the cover/first page — Shelter Insurance uses this label and it is the most reliable source. (2) Look for "Property:" label near the insured name. (3) Look for "Property Address:" anywhere in the document. (4) For Shelter, the address also appears as a mailing address block directly under the insured name on page 1 (no label — just street, city, state zip on separate lines). Return the full street address including city, state and zip as a single string. For section: use the structure or area name the line item belongs to (e.g. "Dwelling", "Storage Shed", "Barn", "Detached Garage", "Other Structures") — this comes from the area/section header above the line item in the PDF. For paidWhenIncurred: read ALL notes and comments printed below each line item. Set to true if the notes say "payable when incurred" or "paid when incurred" or "code upgrade cost is payable when incurred". Set to false for all other items. Return ONLY the JSON object.' }
      ]}]
    });
    const raw = response.content[0].text;
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) return res.status(500).json({ error: 'Failed to parse AI response as JSON', raw });
    const parsed = JSON.parse(raw.slice(first, last + 1));
    const pwiItems = parsed.lineItems?.filter(i => i.paidWhenIncurred) || [];
    console.log('PWI items found:', pwiItems.length, pwiItems.map(i => i.description));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
