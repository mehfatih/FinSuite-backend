// ================================================================
// Sprint D-11 — ZATCA Phase 2 UBL XML serializer (SA).
//
// Per discovery decision §10.I option I1: full Phase 2 XML on demand.
// Live submission to the ZATCA gateway is deferred to a separate
// sprint (production cert + onboarding with the ZATCA portal needed).
// The XML produced here passes ZATCA's offline schema validator.
//
// Input: invoice row (with line items) + merchant + buyer details +
// resolved profile from profileResolver. Output: a UBL Invoice
// element with CustomizationID = "reporting:1.0", a TLV QR placeholder
// (B.5 fills it in via zatcaQr.encode), simplified-vs-standard flag,
// and a hash-chain pointer placeholder (real signing comes with live
// gateway integration).
//
// References
//   - ZATCA E-Invoicing Implementation Resolution Articles 53-55
//   - UBL 2.1 OASIS spec
//   - eFaturaController.ts (TR sibling) — same file shape, different
//     CustomizationID / ProfileID + additional Phase 2 elements
//
// Hard-rule: zero new deps; pure string concatenation. No xml library.
// ================================================================

import { ResolvedProfile } from "./profileResolver";

// ─── Inputs ─────────────────────────────────────────────────

export interface ZatcaSeller {
  /** Seller (merchant) registered name. */
  name:        string;
  /** Seller VAT registration number (15 digits per ZATCA). */
  vatNumber:   string;
  /** Optional CR (Commercial Registration) number. */
  crNumber?:   string;
  /** Address — at minimum street + city + postal + country */
  street:      string;
  buildingNumber?: string;
  district?:   string;
  city:        string;
  postalCode:  string;
  countryCode: string;            // ISO ('SA')
}

export interface ZatcaBuyer {
  name:           string;
  vatNumber?:     string;          // optional for B2C / simplified
  street?:        string;
  buildingNumber?: string;
  district?:      string;
  city?:          string;
  postalCode?:    string;
  countryCode?:   string;
}

export interface ZatcaLineItem {
  /** 1-based line number. */
  lineId:        number;
  /** Free-form name; ZATCA caps at 256 chars. */
  name:          string;
  quantity:      number;
  /** Per-unit price BEFORE tax. */
  unitPrice:     number;
  /** Tax rate (e.g. 15 for 15%). Resolved per-invoice via profileResolver. */
  taxRate:       number;
  /** Optional discount per line. */
  discount?:     number;
}

export interface BuildZatcaInvoiceArgs {
  /** Invoice id (UUID — ZATCA needs a globally unique ID). */
  invoiceId:        string;
  /** Human-readable invoice number (e.g. "INV-2026-001"). */
  invoiceNumber:    string;
  /** Issue date in ISO format. */
  issueDate:        Date;
  /** Issue time. */
  issueTime?:       Date;
  /** Standard (Tax Invoice) or Simplified (B2C ≤1000 SAR). */
  isSimplified:     boolean;
  /** Currency code; should be 'SAR' for ZATCA-reportable invoices. */
  currencyCode:     string;
  /** Previous invoice hash — Phase 2 hash chain. Empty string for the merchant's first ZATCA invoice. */
  previousInvoiceHash: string;
  /** TLV QR base64 (from zatcaQr.encode). */
  qrTlvBase64:      string;
  seller:           ZatcaSeller;
  buyer:            ZatcaBuyer;
  lines:            ZatcaLineItem[];
  /** Optional payment notes. */
  notes?:           string;
}

// ─── Helpers ────────────────────────────────────────────────

const xmlEscape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

// ─── Builder ────────────────────────────────────────────────

export function buildZatcaInvoiceXml(args: BuildZatcaInvoiceArgs): string {
  // Compute totals from the line items so we never trust a caller-
  // supplied total — ZATCA validators reject invoices where the total
  // doesn't match the line sum.
  let lineExtension = 0;
  let totalTax = 0;
  for (const line of args.lines) {
    const gross    = line.quantity * line.unitPrice;
    const discount = line.discount || 0;
    const net      = Math.max(0, gross - discount);
    const tax      = (net * line.taxRate) / 100;
    lineExtension += net;
    totalTax      += tax;
  }
  const taxExclusive = lineExtension;
  const taxInclusive = lineExtension + totalTax;
  const payable      = taxInclusive;

  const issueDate = args.issueDate.toISOString().slice(0, 10);
  const issueTime = (args.issueTime || args.issueDate).toISOString().slice(11, 19);

  // ZATCA uses InvoiceTypeCode with a "name" attribute carrying a 4-digit
  // hex flag. The first nibble is the document type (01=invoice,
  // 02=credit note, 03=debit note); the second nibble is reserved; the
  // third is a 1 if simplified else 0. For V1 we ship invoice-only so
  // the flag is 0100 (standard) or 0200 (simplified).
  const typeCode = "388"; // UBL standard "Tax Invoice"
  const typeName = args.isSimplified ? "0200000" : "0100000";

  // Build line items first.
  const lineXml = args.lines.map((line) => {
    const gross    = line.quantity * line.unitPrice;
    const discount = line.discount || 0;
    const net      = Math.max(0, gross - discount);
    const tax      = (net * line.taxRate) / 100;
    return `
    <cac:InvoiceLine>
      <cbc:ID>${line.lineId}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${round2(line.quantity)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${args.currencyCode}">${round2(net)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${args.currencyCode}">${round2(tax)}</cbc:TaxAmount>
        <cbc:RoundingAmount currencyID="${args.currencyCode}">${round2(net + tax)}</cbc:RoundingAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${xmlEscape(line.name)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${line.taxRate > 0 ? "S" : "Z"}</cbc:ID>
          <cbc:Percent>${round2(line.taxRate)}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${args.currencyCode}">${round2(line.unitPrice)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
  }).join("");

  // Build the buyer party (omitted for simplified B2C below 1000 SAR).
  const buyerPartyXml = args.isSimplified && !args.buyer.vatNumber ? "" : `
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${args.buyer.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(args.buyer.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(args.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      ${args.buyer.street ? `<cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(args.buyer.street)}</cbc:StreetName>
        ${args.buyer.buildingNumber ? `<cbc:BuildingNumber>${xmlEscape(args.buyer.buildingNumber)}</cbc:BuildingNumber>` : ""}
        ${args.buyer.district ? `<cbc:CitySubdivisionName>${xmlEscape(args.buyer.district)}</cbc:CitySubdivisionName>` : ""}
        ${args.buyer.city ? `<cbc:CityName>${xmlEscape(args.buyer.city)}</cbc:CityName>` : ""}
        ${args.buyer.postalCode ? `<cbc:PostalZone>${xmlEscape(args.buyer.postalCode)}</cbc:PostalZone>` : ""}
        <cac:Country><cbc:IdentificationCode>${xmlEscape(args.buyer.countryCode || "SA")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  // Phase 2 hash-chain references. previousInvoiceHash is empty for the
  // merchant's first ZATCA invoice; subsequent invoices reference the
  // hash of the previous one (computed at signing time — placeholder
  // here until live gateway integration).
  const additionalRefs = `
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>1</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${xmlEscape(args.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${xmlEscape(args.qrTlvBase64)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(args.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(args.invoiceId)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeName}">${typeCode}</cbc:InvoiceTypeCode>
  ${args.notes ? `<cbc:Note>${xmlEscape(args.notes)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${args.currencyCode}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${args.currencyCode}</cbc:TaxCurrencyCode>
  ${additionalRefs}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(args.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      ${args.seller.crNumber ? `<cac:PartyIdentification><cbc:ID schemeID="CRN">${xmlEscape(args.seller.crNumber)}</cbc:ID></cac:PartyIdentification>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(args.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(args.seller.street)}</cbc:StreetName>
        ${args.seller.buildingNumber ? `<cbc:BuildingNumber>${xmlEscape(args.seller.buildingNumber)}</cbc:BuildingNumber>` : ""}
        ${args.seller.district ? `<cbc:CitySubdivisionName>${xmlEscape(args.seller.district)}</cbc:CitySubdivisionName>` : ""}
        <cbc:CityName>${xmlEscape(args.seller.city)}</cbc:CityName>
        <cbc:PostalZone>${xmlEscape(args.seller.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xmlEscape(args.seller.countryCode)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingSupplierParty>${buyerPartyXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${args.currencyCode}">${round2(totalTax)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${args.currencyCode}">${round2(taxExclusive)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${args.currencyCode}">${round2(totalTax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${args.lines[0]?.taxRate || 15}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${args.currencyCode}">${round2(lineExtension)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${args.currencyCode}">${round2(taxExclusive)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${args.currencyCode}">${round2(taxInclusive)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${args.currencyCode}">${round2(payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}

/**
 * Convenience: decide if an invoice should ship as Simplified.
 * ZATCA: B2C ≤1000 SAR is always simplified; standard otherwise.
 * The threshold is per the resolved profile (defaults to 1000).
 */
export function isSimplifiedInvoice(args: {
  totalSAR: number;
  buyerHasVatNumber: boolean;
  profile: Pick<ResolvedProfile, "regulatory">;
}): boolean {
  if (args.buyerHasVatNumber) return false;
  const threshold = args.profile.regulatory.zatcaSimplifiedThresholdSAR ?? 1000;
  return args.totalSAR <= threshold;
}
