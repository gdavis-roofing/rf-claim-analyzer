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
      max_tokens: 4000,
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
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  const jsonText = (firstBrace !== -1 && lastBrace !== -1)
    ? rawText.slice(firstBrace, lastBrace + 1)
    : rawText.trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse error:", e);
    console.error("Raw text length:", rawText.length);
    console.error("Raw text first 500:", rawText.substring(0, 500));
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
  - Angle brackets  <200.00>  = NON-RECOVERABLE depreciation
  - Parentheses     (200.00)  = RECOVERABLE depreciation
  - (0.00) or <0.00>          = zero depreciation

For EACH line item, record:
  - recoverableDep:    the dollar amount in parentheses (0 if none)
  - nonRecoverableDep: the dollar amount in angle brackets (0 if none)

A single line item can have ONLY one type — never both.
The sum recoverableDep + nonRecoverableDep equals the total depreciation withheld on that item.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POLICY TYPE DETECTION (read from the SUMMARY page)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Determine policyType by reading the summary page carefully:

"RCV" — Full replacement cost policy. Indicators:
  - Summary shows "Total Recoverable Depreciation" equal to ALL the depreciation withheld
  - Summary shows "Net Claim if Depreciation is Recovered" = a higher number
  - No "Non-recoverable" line in summary (or non-rec = $0)
  - Example carriers: Auto-Owners (Brotherton), USAA, some State Farm

"ACV" — Actual cash value / scheduled roof policy. Indicators:
  - Summary shows "Less Non-recoverable Depreciation <amount>" and that amount equals ALL depreciation
  - Summary shows "Total Recoverable Depreciation: 0.00" (or no recoverable dep line)
  - Customer will NEVER get depreciation back
  - Example carriers: Farm Bureau (ACV policies), some Auto-Owners

"MIXED" — Partial RCV policy. Indicators:
  - Summary shows BOTH a non-recoverable dep amount AND a recoverable dep amount
  - The summary explicitly lists "Less Non-Recoverable Depreciation <X>" followed by "Total Recoverable Depreciation Y" where Y > 0
  - Example: Farmers Insurance often withholds non-rec dep on roof materials but allows recovery on gutters/windows/siding

"UNKNOWN" — Use only if you cannot determine the policy type.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
O&P DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Some carriers include General Contractor Overhead and Profit:
  - State Farm: Look for "General Contractor Overhead" and "General Contractor Profit" lines in the summary or line items
  - USAA: Has a dedicated O&P column in the line items (often 0.00 on each line)
  - Xactimate-based: May show O&P as separate line items at the bottom of sections

If O&P is present as separate line items, include them in the line items array like any other item.
Set hasOP: true in the result if any O&P is detected (whether in line items or as summary additions).
Set opTotal: the total O&P dollar amount if detectable, or 0 if not present.

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

Extract these from the claim's Summary page (match them EXACTLY to what is printed):
  - summaryRCV:             The "Replacement Cost Value" total
  - summaryNonRecDep:       "Less Non-recoverable Depreciation" (as a positive number, 0 if absent)
  - summaryRecDep:          "Total Recoverable Depreciation" (as a positive number, 0 if absent)
  - summaryTotalDep:        Total depreciation withheld (nonRec + rec)
  - summaryACV:             Total "Actual Cash Value" BEFORE deducting the deductible. This is RCV minus total depreciation. Do NOT subtract the deductible from this number.
  - summaryDeductible:      "Less Deductible" (as a positive number)
  - summaryNetClaim:        Total initial payment amount — use the FINAL net payment figure that already has the deductible subtracted. For Shelter this is "Net Estimate", for other carriers this is "Net Claim". This should equal summaryACV minus summaryDeductible.
  - summaryNetIfRecovered:  "Net Claim if Depreciation is Recovered" (0 if absent)

These numbers MUST match the claim's own summary page. Do not calculate them — read them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return this exact JSON structure:

{
  "carrier": "State Farm",
  "policyType": "RCV",
  "hasOP": false,
  "opTotal": 0,
  "summaryRCV": 7116.96,
  "summaryNonRecDep": 0,
  "summaryRecDep": 1623.66,
  "summaryTotalDep": 1623.66,
  "summaryACV": 5493.30,
  "summaryDeductible": 1000.00,
  "summaryNetClaim": 4493.30,
  "summaryNetIfRecovered": 6116.96,
  "lineItems": [
    {
      "lineNumber": 1,
      "description": "Tear off composition shingles - Laminated (no haul off)",
      "quantity": "14.44 SQ",
      "rcv": 920.98,
      "recoverableDep": 0,
      "nonRecoverableDep": 0,
      "acv": 920.98
    },
    {
      "lineNumber": 2,
      "description": "Roofing felt - 15 lb.",
      "quantity": "14.44 SQ",
      "rcv": 473.82,
      "recoverableDep": 189.52,
      "nonRecoverableDep": 0,
      "acv": 284.30
    },
    {
      "lineNumber": 3,
      "description": "Laminated - comp. shingle rfg. - w/out felt",
      "quantity": "14.67 SQ",
      "rcv": 3765.38,
      "recoverableDep": 1004.10,
      "nonRecoverableDep": 0,
      "acv": 2761.28
    }
  ]
}

IMPORTANT RULES:
1. Include EVERY numbered line item — do not skip any, including steep roof charges, satellite detach/reset, dumpster loads, etc.
2. For the description field, use the full line item description as written in the claim.
3. Dollar amounts as plain numbers (no $ signs, no commas). Use 2 decimal places.
4. recoverableDep and nonRecoverableDep are always >= 0. Never negative.
5. If a line item has zero depreciation, both recoverableDep and nonRecoverableDep are 0.
6. The quantity field is a string including the unit (e.g. "34.01 SQ", "255.93 LF", "1.00 EA").
7. If the claim has multiple coverage sections (Dwelling + Other Structures), include ALL line items from ALL sections.
8. Read the summary values directly from the printed summary page — do not compute them yourself.
9. Return ONLY the JSON object — no text before or after it.`;
}
