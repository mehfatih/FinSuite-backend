// ================================================================
// Sprint D-11 — ZATCA TLV QR encoder.
//
// Per discovery decision §10.M: hand-rolled, zero deps. ZATCA's QR
// payload is a TLV (Tag-Length-Value) blob, base64-encoded. The QR
// IMAGE itself is rendered downstream (qrcode.react on the frontend
// or a Puppeteer-rendered PNG in the PDF template) — this module
// only produces the base64 string that goes inside the QR.
//
// Spec reference: ZATCA E-Invoicing Implementation Resolution
// Article 53 §3 + the ZATCA QR Code Specification document.
//
// Five tags for Phase 2 simplified + standard invoices:
//   1: Seller name                     (UTF-8 bytes)
//   2: Seller VAT registration number  (ASCII, 15 digits)
//   3: Timestamp (ISO-8601, e.g. "2026-05-10T14:23:00Z")
//   4: Invoice total with VAT          (decimal string, e.g. "115.00")
//   5: VAT total                       (decimal string, e.g. "15.00")
//
// (Tags 6-9 — XML hash, EC public key, ECDSA signature stamp — are
// added during gateway signing and are out of scope for V1 per
// decision §10.I.)
//
// Output: base64-encoded TLV blob, e.g.
//   AQ5BbCBGYWhhZCBUcmFkaW5nAg8zMTA0NTcxNzg2MDAwMDMDFDIwMjYtMDUtMTBUMTQ6MjM6MDBaBAYxMTUuMDAFBTE1LjAw
//
// Hard-rule: zero new deps. Uses Buffer + TextEncoder only (Node
// built-ins). Output is ASCII-safe base64 ready to embed in UBL
// EmbeddedDocumentBinaryObject (mimeCode="text/plain").
// ================================================================

export interface ZatcaQrPayload {
  /** Seller (merchant) registered name. Encoded as UTF-8 (Arabic OK). */
  sellerName:    string;
  /** Seller VAT registration number — exactly 15 digits per ZATCA. */
  vatNumber:     string;
  /** Invoice issue timestamp. Encoded as ISO-8601 in UTC. */
  timestamp:     Date;
  /** Invoice total INCLUDING VAT, in SAR. */
  totalAmount:   number;
  /** VAT total in SAR. */
  vatAmount:     number;
}

/**
 * Encode the ZATCA Phase 2 TLV QR payload to base64.
 *
 * The encoding rule per ZATCA spec:
 *   For each tag: [tagByte (1)] [valueLengthByte (1)] [value bytes]
 *   Concatenate all 5 tags; base64-encode the resulting buffer.
 *
 * Tag values longer than 255 bytes are not currently supported
 * (ZATCA's spec allows it via 0x82 length prefix; merchants usually
 * stay well under 255 bytes for these 5 fields).
 */
export function encodeZatcaQr(payload: ZatcaQrPayload): string {
  // Round monetary amounts to two decimals per ZATCA spec.
  const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

  // ISO-8601 timestamp normalized to UTC, second precision.
  const ts = payload.timestamp.toISOString().replace(/\.\d{3}Z$/, "Z");

  const tags: Array<{ tag: number; bytes: Buffer }> = [
    { tag: 1, bytes: Buffer.from(payload.sellerName, "utf8") },
    { tag: 2, bytes: Buffer.from(payload.vatNumber, "ascii") },
    { tag: 3, bytes: Buffer.from(ts, "ascii") },
    { tag: 4, bytes: Buffer.from(round2(payload.totalAmount), "ascii") },
    { tag: 5, bytes: Buffer.from(round2(payload.vatAmount), "ascii") }
  ];

  const parts: Buffer[] = [];
  for (const { tag, bytes } of tags) {
    if (bytes.length > 255) {
      // ZATCA's spec allows long-form length, but our 5 tags should
      // always fit in 255 bytes. Truncate seller name as a safety
      // net rather than emitting an invalid QR.
      const truncated = bytes.subarray(0, 255);
      parts.push(Buffer.from([tag, truncated.length]));
      parts.push(truncated);
    } else {
      parts.push(Buffer.from([tag, bytes.length]));
      parts.push(bytes);
    }
  }

  return Buffer.concat(parts).toString("base64");
}

/**
 * Decode a base64 TLV payload back into the 5 fields. Used by tests
 * + the admin diagnostic UI; production path is encode-only.
 */
export function decodeZatcaQr(base64: string): Partial<ZatcaQrPayload> & { _raw: Record<number, string> } {
  const buf = Buffer.from(base64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i++];
    const len = buf[i++];
    const val = buf.subarray(i, i + len);
    out[tag] = val.toString("utf8");
    i += len;
  }
  return {
    sellerName:  out[1],
    vatNumber:   out[2],
    timestamp:   out[3] ? new Date(out[3]) : undefined,
    totalAmount: out[4] ? Number(out[4]) : undefined,
    vatAmount:   out[5] ? Number(out[5]) : undefined,
    _raw:        out
  };
}
