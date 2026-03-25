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

    // Strip markdown code fences if present
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
      return res
        .status(500)
        .json({ error: "Failed to parse AI response as JSON", raw: rawText });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("Parse claim error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}

function buildParserPrompt() {
  return `You are an expert insurance claim reader for Roofing Force, a roofing contractor.

Read this insurance claim PDF and extract ALL line items. Return ONLY valid JSON — no preamble, no markdown fences, no explanation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPRECIATION SYMBOL RULES (apply to EVERY carrier)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Depreciation appears in two formats in the DEPREC. column:
  - Angle brackets  <200.00>  = NON-RECOVERABLE depreciation → nonRecoverableDep = 200.00, recoverableDep = 0
  - Parentheses     (200.00)  = RECOVERABLE depreciation → recoverableDep = 200.00, nonRecoverableDep = 0
  - (0.00) or <0.00>          = zero depreciation, both fields = 0

A single line item can have ONLY one type — never both.
The sum recoverableDep + nonRecoverableDep equals the total depreciation withheld on that item.

CONCRETE EXAMPLES from an Auto-Owners claim:
  "Replace Drip edge"  RCV=801.44  DEPREC. column shows <343.47>  ACV=457.97
    → nonRecoverableDep: 343.47, recoverableDep: 0

  "Replace Roofing felt - 15 lb."  RCV=1050.66  DEPREC. column shows <787.99>  ACV=262.67
    → nonRecoverableDep: 787.99, recoverableDep: 0

  "Tear off composition shingles"  RCV=1279.67  DEPREC. column shows <0.00>  ACV=1279.67
    → nonRecoverableDep: 0, recoverableDep: 0

  "Replace Roofing felt - 15 lb."  RCV=473.82  DEPREC. column shows (189.52)  ACV=284.30
    → recoverableDep: 189.52, nonRecoverableDep: 0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MULTIPLE STRUCTURES — CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Many claims cover multiple structures: Dwelling, Detached Garage, Detached Garage 2, Shed, etc.
You MUST include line items from ALL structures — do not stop after the first structure.

For the "section" field, combine the structure name and the subsection:
  - Dwelling roofing → "Roofing"
  - Dwelling south elevation → "South/Front"
  - Dwelling gutters → "Gutter/Downspouts"
  - Detached Garage roofing → "Detached Garage — Roofing"
  - Detached Garage south elevation → "Detached Garage — South/Front"
  - Detached Garage 2 roofing → "Detached Garage 2 — Roofing"
  - Detached Garage 2 south elevation → "Detached Garage 2 — South/Front"
  - Dumpster → "Dumpster"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POLICY TYPE DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"RCV" — All or nearly all depreciation is in parentheses (recoverable). Summary shows recoverable dep.
"ACV" — All or nearly all depreciation is in angle brackets (non-recoverable). No recoverable dep.
"MIXED" — Significant amounts of BOTH parentheses and angle bracket depreciation exist.
"UNKNOWN" — Cannot determine.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
O&P DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If O&P is present as separate line items, include them like any other item.
Set hasOP: true if any O&P is detected. Set opTotal to the total O&P amount, or 0 if not present.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARRIER COLUMN FORMAT REFERENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

State Farm / Xactimate / Farmers: QUANTITY | UNIT PRICE | TAX | RCV | AGE/LIFE | COND. | DEP% | DEPREC. | ACV
Farm Bureau (Xactimate):          QUANTITY | UNIT | TAX | RCV | AGE/LIFE | COND. | DEP% | DEPREC. | ACV
Auto-Owners:                      DESCRIPTION | QUANTITY | UNIT PRICE | TAX | RCV | DEPREC. | ACV
USAA (Allcat):                    QUANTITY | UNIT | TAX | O&P | RCV | AGE/LIFE | DEPREC. | ACV

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY PAGE VALUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the claim has MULTIPLE summary pages (e.g. one for Dwelling and one for Other Structures),
ADD the values together to produce a single combined total for each field.

Extract these (combine across all summary pages if multiple exist):
  - summaryRCV:             Total "Replacement Cost Value" across all structures
  - summaryNonRecDep:       Total "Less Non-recoverable Depreciation" (positive number, 0 if absent)
  - summaryRecDep:          Total "Total Recoverable Depreciation" (positive number, 0 if absent)
  - summaryTotalDep:        summaryNonRecDep + summaryRecDep
  - summaryACV:             Total "Actual Cash Value" across all structures
  - summaryDeductible:      "Less Deductible" (positive number — use the Dwelling deductible if split)
  - summaryNetClaim:        Total "Net Claim" across all structures
  - summaryNetIfRecovered:  "Net Claim if Depreciation is Recovered" (0 if absent)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return this exact JSON structure:

{
  "carrier": "Auto-Owners",
  "policyType": "ACV",
  "hasOP": false,
  "opTotal": 0,
  "summaryRCV": 39609.48,
  "summaryNonRecDep": 15380.96,
  "summaryRecDep": 0,
  "summaryTotalDep": 15380.96,
  "summaryACV": 24228.52,
  "summaryDeductible": 5000.00,
  "summaryNetClaim": 19228.52,
  "summaryNetIfRecovered": 0,
  "lineItems": [
    {
      "lineNumber": 1,
      "description": "Tear off composition shingles - Laminated (no haul off)",
      "quantity": "31.92 SQ",
      "rcv": 1279.67,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 1279.67,
      "section": "Roofing"
    },
    {
      "lineNumber": 2,
      "description": "Replace Drip edge",
      "quantity": "285.19 LF",
      "rcv": 801.44,
      "recoverableDep": 0,
      "nonRecoverableDep": 343.47,
      "acv": 457.97,
      "section": "Roofing"
    },
    {
      "lineNumber": 3,
      "description": "Replace Roofing felt - 15 lb.",
      "quantity": "31.92 SQ",
      "rcv": 1050.66,
      "recoverableDep": 0,
      "nonRecoverableDep": 787.99,
      "acv": 262.67,
      "section": "Roofing"
    },
    {
      "lineNumber": 38,
      "description": "Tear off composition shingles - Laminated (no haul off)",
      "quantity": "8.41 SQ",
      "rcv": 337.16,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 337.16,
      "section": "Detached Garage — Roofing"
    },
    {
      "lineNumber": 71,
      "description": "Dumpster load - Approx. 30 yards, 5-7 tons of debris",
      "quantity": "1.00 EA",
      "rcv": 794.69,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 794.69,
      "section": "Dumpster"
    }
  ]
}

IMPORTANT RULES:
1. Include EVERY numbered line item from EVERY structure — do not skip any, including steep roof charges, satellite detach/reset, dumpster loads, A/C items, doors, windows, painting, cleaning, etc.
2. Use the full line item description exactly as written in the claim.
3. Dollar amounts as plain numbers (no $ signs, no commas). Use 2 decimal places.
4. recoverableDep and nonRecoverableDep are always >= 0. Never negative.
5. If a line item shows <0.00> or (0.00) in the DEPREC. column, both dep fields = 0.
6. The quantity field is a string including the unit (e.g. "31.92 SQ", "285.19 LF", "1.00 EA").
7. Always include the section field on every line item.
8. Read summary values from the printed summary pages — do not compute them yourself.
9. If there are separate summaries for Dwelling and Other Structures, ADD them together.
10. Return ONLY the JSON object — no text before or after it.`;
}