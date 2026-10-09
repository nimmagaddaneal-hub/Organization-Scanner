document.getElementById('print-button')?.addEventListener('click', () => window.print());
// Changing the label size reloads the sheet at that size.
document.querySelector('.size-form select')?.addEventListener('change', (event) => event.target.form.submit());
