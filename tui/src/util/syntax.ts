import { SyntaxStyle, parseColor } from "@opentui/core";

export function createSolarizedDarkSyntax(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: parseColor("#839496") },
    
    keyword: { fg: parseColor("#859900"), bold: true },
    string: { fg: parseColor("#2aa198") },
    comment: { fg: parseColor("#586e75"), italic: true },
    number: { fg: parseColor("#d33682") },
    function: { fg: parseColor("#268bd2") },
    type: { fg: parseColor("#b58900") },
    operator: { fg: parseColor("#859900") },
    variable: { fg: parseColor("#839496") },
    
    "markup.heading": { fg: parseColor("#268bd2"), bold: true },
    "markup.heading.1": { fg: parseColor("#cb4b16"), bold: true, underline: true },
    "markup.heading.2": { fg: parseColor("#268bd2"), bold: true },
    "markup.heading.3": { fg: parseColor("#2aa198") },
    "markup.bold": { bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.list": { fg: parseColor("#268bd2") },
    "markup.quote": { fg: parseColor("#586e75"), italic: true },
    "markup.raw": { fg: parseColor("#2aa198"), bg: parseColor("#073642") },
    "markup.link": { fg: parseColor("#268bd2"), underline: true },
    "markup.link.label": { fg: parseColor("#2aa198"), underline: true },
    "markup.link.url": { fg: parseColor("#268bd2"), underline: true },
    
    conceal: { fg: parseColor("#586e75") },
    "punctuation.special": { fg: parseColor("#586e75") },
  });
}

export const solarizedDarkSyntax = createSolarizedDarkSyntax();
