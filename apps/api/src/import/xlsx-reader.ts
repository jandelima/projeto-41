import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

export type FormulaCell = { formula: string; value: unknown };
export type WorkbookCell = string | number | boolean | Date | FormulaCell | null;
export type WorkbookData = Record<string, WorkbookCell[][]>;

export function readWorkbook(path: string): WorkbookData {
  const zip = new AdmZip(path);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
    trimValues: false
  });
  const readXml = (entry: string) => {
    const content = zip.readAsText(entry);
    if (!content) throw new Error(`Missing XLSX entry: ${entry}`);
    return parser.parse(content);
  };

  const workbook = readXml("xl/workbook.xml").workbook;
  const relationships = asArray(
    readXml("xl/_rels/workbook.xml.rels").Relationships.Relationship
  );
  const relationshipMap = new Map(
    relationships.map((relationship) => [relationship["@_Id"], relationship["@_Target"]])
  );
  const sharedStrings = readSharedStrings(zip, parser);
  const dateStyles = readDateStyles(zip, parser);

  return Object.fromEntries(
    asArray<any>(workbook.sheets.sheet).map((sheet) => {
      const target = relationshipMap.get(sheet["@_r:id"]);
      if (!target) throw new Error(`Missing relationship for sheet ${sheet["@_name"]}`);
      const entry = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      const worksheet = readXml(entry).worksheet;
      const rows: WorkbookCell[][] = [];
      for (const row of asArray<any>(worksheet.sheetData?.row)) {
        const rowIndex = Number(row["@_r"] ?? rows.length + 1) - 1;
        rows[rowIndex] ??= [];
        for (const cell of asArray<any>(row.c)) {
          const columnIndex = decodeColumn(String(cell["@_r"] ?? "A1"));
          rows[rowIndex]![columnIndex] = parseCell(cell, sharedStrings, dateStyles);
        }
      }
      for (const row of rows) {
        if (!row) continue;
        for (let index = 0; index < row.length; index += 1) row[index] ??= null;
      }
      return [sheet["@_name"], rows];
    })
  );
}

function readSharedStrings(zip: AdmZip, parser: XMLParser) {
  const entry = zip.getEntry("xl/sharedStrings.xml");
  if (!entry) return [];
  const document = parser.parse(entry.getData().toString("utf8")).sst;
  return asArray(document.si).map((item) => collectText(item));
}

function readDateStyles(zip: AdmZip, parser: XMLParser) {
  const entry = zip.getEntry("xl/styles.xml");
  if (!entry) return new Set<number>();
  const styles = parser.parse(entry.getData().toString("utf8")).styleSheet;
  const custom = new Map<number, string>(
    asArray<any>(styles.numFmts?.numFmt).map((format) => [
      Number(format["@_numFmtId"]),
      String(format["@_formatCode"] ?? "")
    ])
  );
  const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const result = new Set<number>();
  asArray<any>(styles.cellXfs?.xf).forEach((style, index) => {
    const formatId = Number(style["@_numFmtId"] ?? 0);
    const format = custom.get(formatId) ?? "";
    if (builtInDates.has(formatId) || /[dmyhs]/i.test(format.replace(/"[^"]*"/g, ""))) {
      result.add(index);
    }
  });
  return result;
}

function parseCell(
  cell: any,
  sharedStrings: string[],
  dateStyles: Set<number>
): WorkbookCell {
  const type = cell["@_t"];
  const raw = scalar(cell.v);
  let resolved: WorkbookCell;
  if (type === "s") resolved = sharedStrings[Number(raw)] ?? "";
  else if (type === "inlineStr") resolved = collectText(cell.is);
  else if (type === "b") resolved = raw === "1";
  else if (type === "str") resolved = String(raw ?? "");
  else if (raw === null || raw === undefined || raw === "") resolved = null;
  else {
    const numeric = Number(raw);
    resolved =
      dateStyles.has(Number(cell["@_s"] ?? -1)) && Number.isFinite(numeric)
        ? excelDate(numeric)
        : numeric;
  }

  const formula = scalar(cell.f);
  return formula ? { formula: String(formula), value: resolved } : resolved;
}

function collectText(node: any): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object") {
    if ("t" in node) return collectText(node.t);
    if ("#text" in node) return String(node["#text"]);
    return Object.entries(node)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, value]) => collectText(value))
      .join("");
  }
  return "";
}

function scalar(node: any): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return node;
  return node["#text"] ?? null;
}

function excelDate(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

function decodeColumn(reference: string) {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
