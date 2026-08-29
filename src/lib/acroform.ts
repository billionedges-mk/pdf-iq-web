/**
 * Carrying form fields across a merge.
 *
 * pdf-lib's copyPages brings the widget annotations with each page, but a widget alone
 * is not a form field: the interactive form is the /AcroForm /Fields tree in the
 * catalog. Without rebuilding that, a merged file shows boxes that look like fields and
 * behave like decoration — filled values do not save.
 *
 * Two documents also routinely use the same field name ("Name", "Date", "Signature"),
 * and in PDF a shared name means a shared *value*: type in one and the other changes.
 * So duplicates are renamed per source file, which is what the design promises.
 */

import { PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFHexString, PDFString } from 'pdf-lib';

export interface FormMergeResult {
  fields: number;
  renamed: number;
}

function fieldName(dict: PDFDict): string | null {
  const t = dict.lookup(PDFName.of('T'));
  if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText();
  return null;
}

/** The topmost node of a field's parent chain — the entry that belongs in /Fields. */
function rootField(doc: PDFDocument, ref: PDFRef, depth = 0): PDFRef {
  if (depth > 24) return ref;
  const dict = doc.context.lookup(ref);
  if (!(dict instanceof PDFDict)) return ref;
  const parent = dict.get(PDFName.of('Parent'));
  if (parent instanceof PDFRef) {
    const parentDict = doc.context.lookup(parent);
    // A widget's Parent is only a field if it is itself named or has a field type.
    if (parentDict instanceof PDFDict &&
      (parentDict.has(PDFName.of('T')) || parentDict.has(PDFName.of('FT')))) {
      return rootField(doc, parent, depth + 1);
    }
  }
  return ref;
}

/**
 * Collect the form fields on the pages of `doc` into its own AcroForm, giving every
 * field a name unique across the whole document.
 */
export function rebuildAcroForm(doc: PDFDocument): FormMergeResult {
  const context = doc.context;
  const roots: PDFRef[] = [];
  const seen = new Set<string>();

  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const dict = context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!(subtype instanceof PDFName) || subtype.asString() !== '/Widget') continue;

      const root = rootField(doc, ref);
      const key = root.toString();
      if (!seen.has(key)) {
        seen.add(key);
        roots.push(root);
      }
    }
  }

  if (!roots.length) {
    doc.catalog.delete(PDFName.of('AcroForm'));
    return { fields: 0, renamed: 0 };
  }

  // Rename collisions. In PDF, two fields sharing a name share a value, so leaving
  // duplicates would silently link unrelated boxes across the merged files.
  const used = new Map<string, number>();
  let renamed = 0;
  for (const ref of roots) {
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    const name = fieldName(dict);
    if (name === null) continue;
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (count > 0) {
      dict.set(PDFName.of('T'), PDFHexString.fromText(`${name} (${count + 1})`));
      renamed++;
    }
  }

  const fields = context.obj(roots) as PDFArray;
  const existing = doc.catalog.lookup(PDFName.of('AcroForm'));
  const form = existing instanceof PDFDict ? existing : (context.obj({}) as PDFDict);
  form.set(PDFName.of('Fields'), fields);
  // Ask the viewer to generate appearances it does not already have, rather than
  // shipping fields that render blank until they are clicked.
  form.set(PDFName.of('NeedAppearances'), context.obj(true));
  if (!(existing instanceof PDFDict)) {
    doc.catalog.set(PDFName.of('AcroForm'), context.register(form));
  }

  return { fields: roots.length, renamed };
}

/** Does this document have an interactive form at all? */
export function hasFormFields(doc: PDFDocument): boolean {
  const form = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(form instanceof PDFDict)) return false;
  const fields = form.lookup(PDFName.of('Fields'));
  return fields instanceof PDFArray && fields.size() > 0;
}
