// /api/parse-claim.js
// Roofing Force RF Claim Scope — PDF parser
// Extracts line items with recoverable/non-recoverable depreciation split
// Supports: State Farm, Farm Bureau, Auto-Owners, Farmers, USAA, and Xactimate-based carriers

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { pdfBase64, filename } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: "No PDF data provided" });
    }

    const prompt = buildParserPrompt();

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0].text;

    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse error:", e);
      console.error("Raw response:", rawText);
      return res.status(500).json({ error: "Failed to parse AI response as JSON", raw: rawText });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("Parse claim error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

function buildParserPrompt() {
  return `You are an expert insurance claim reader for Roofing Force, a roofing contractor.

Read this insurance claim PDF and extract ALL line items plus customer/claim info. Return ONLY valid JSON — no preamble, no markdown fences, no explanation.

CUSTOMER & CLAIM INFO
Extract the following from the claim header or cover page:
  - customerName:    The insured's full name. Look for "Insured:", "Named Insured:", or similar labels.
  - customerAddress: Full property/loss address including city, state, zip. Look for "Property:", "Loss Location:", or "Property Address:".
  - claimNumber:     The claim or file number. Look for "Claim #", "Claim Number", "File #", "L/R Number", or "Policy Number". Use the most specific claim identifier.
  - deductible:      The deductible amount for the Dwelling coverage as a plain number.

If any field cannot be found, use "" for text fields and 0 for deductible.

DEPRECIATION SYMBOL RULES
  - Angle brackets  <200.00>  = NON-RECOVERABLE → nonRecoverableDep = 200.00, recoverableDep = 0
  - Parentheses     (200.00)  = RECOVERABLE → recoverableDep = 200.00, nonRecoverableDep = 0
  - (0.00) or <0.00> = zero depreciation, both fields = 0

PAID WHEN INCURRED ITEMS
Some items are code upgrades or "Paid When Incurred" — insurance pays these AFTER work is done and proof submitted.
These often appear with strikethrough text in the PDF or are noted as "payable when incurred" or "Building Ordinance/Code Upgrade".
Set paidWhenIncurred: true for these items, false for all others.
These items still have RCV and ACV values — include them normally, just flag them.

MULTIPLE STRUCTURES
Include line items from ALL structures. For the section field:
  - Dwelling roofing → "Roofing"
  - Dwelling elevations → "Front/Rear/Side Elevation"
  - Detached Garage roofing → "Detached Garage — Roofing"
  - Debris/haul → "Debris Removal"
  - Labor minimums → "Labor Minimums"

POLICY TYPE
"RCV" = mostly recoverable (parentheses) depreciation
"ACV" = mostly non-recoverable (angle brackets) depreciation
"MIXED" = significant amounts of both
"UNKNOWN" = cannot determine

CARRIER COLUMN FORMAT REFERENCE
State Farm / Xactimate / Farmers: QUANTITY | UNIT PRICE | TAX | RCV | AGE/LIFE | COND. | DEP% | DEPREC. | ACV
Auto-Owners: DESCRIPTION | QUANTITY | UNIT PRICE | TAX | RCV | DEPREC. | ACV
USAA (Allcat): QUANTITY | UNIT | TAX | O&P | RCV | AGE/LIFE | DEPREC. | ACV

SUMMARY VALUES
If multiple summary pages exist, ADD them together.
  - summaryRCV: Total Replacement Cost Value
  - summaryNonRecDep: Total non-recoverable depreciation (positive number)
  - summaryRecDep: Total recoverable depreciation (positive number)
  - summaryTotalDep: summaryNonRecDep + summaryRecDep
  - summaryACV: Total Actual Cash Value
  - summaryDeductible: Deductible (positive number)
  - summaryNetClaim: Total Net Claim
  - summaryNetIfRecovered: Net Claim if Depreciation Recovered (0 if absent)
  - summaryPriorPayments: Prior payments already made (positive number, 0 if none)

OUTPUT FORMAT — return exactly this structure:
{
  "customerName": "Joshua Martin",
  "customerAddress": "284 Polk Road 119, Mena, AR 71953",
  "claimNumber": "018864312-90A",
  "carrier": "USAA",
  "policyType": "RCV",
  "hasOP": false,
  "opTotal": 0,
  "summaryRCV": 26848.10,
  "summaryNonRecDep": 0,
  "summaryRecDep": 10628.99,
  "summaryTotalDep": 10628.99,
  "summaryACV": 16219.11,
  "summaryDeductible": 10000.00,
  "summaryNetClaim": 539.67,
  "summaryNetIfRecovered": 11168.66,
  "summaryPriorPayments": 5342.66,
  "lineItems": [
    {
      "lineNumber": 1,
      "description": "Remove 3 tab - 25 yr. - composition shingle roofing - incl. felt",
      "quantity": "55.90 SQ",
      "rcv": 3252.82,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 3252.82,
      "section": "Roofing",
      "paidWhenIncurred": false
    },
    {
      "lineNumber": 7,
      "description": "Ice & water barrier",
      "quantity": "1442.42 SF",
      "rcv": 2322.22,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 2322.22,
      "section": "Roofing",
      "paidWhenIncurred": true
    }
  ]
}

RULES:
1. Include EVERY numbered line item from EVERY structure — do not skip any.
2. Use the full description exactly as written.
3. Dollar amounts as plain numbers, 2 decimal places. No $ or commas.
4. recoverableDep and nonRecoverableDep always >= 0.
5. Always include paidWhenIncurred on every line item.
6. quantity is a string including unit (e.g. "31.92 SQ").
7. Always include section on every line item.
8. Read summary values from printed summary pages — do not compute them.
9. Return ONLY the JSON object.`;
}
