// js/upload/prerecepcion.js
// Pre-recepción XLSX parser. Filled in by Task 11.
export const prerecepcionParser = {
  id: 'prerecepcion',
  label: 'Pre-recepción',
  acceptedExtensions: ['.xlsx', '.xls'],
  async parse(_file) {
    throw new Error('prerecepcionParser.parse not yet implemented');
  },
};
