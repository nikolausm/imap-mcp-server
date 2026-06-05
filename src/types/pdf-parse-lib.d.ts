// @types/pdf-parse only declares the package root ("pdf-parse"), not the
// internal entry point we import to avoid the package's debug-mode side effect.
// Re-map the subpath import to the same types.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdfParse from 'pdf-parse';
  export default pdfParse;
}
