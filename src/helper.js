/**
 * Converts a 0-based column index number into its corresponding spreadsheet A1 Letter sequence
 * @param {number} colIndex - 0-based index (e.g., 0 -> A, 8 -> I, 9 -> J)
 * @returns {string} Column letter string
 */
export function getColumnLetter(colIndex) {
  let letter = "";
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Formats standard JavaScript date objects cleanly back into DD/MM/YYYY text formats for Sheet cells
 * @param {Date} dateObj - The date object to format
 * @returns {string} Formatted date string
 */
export function formatSheetDate(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}
