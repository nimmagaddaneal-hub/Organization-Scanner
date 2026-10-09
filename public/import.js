// Fills the import box with the contents of a chosen spreadsheet file.
(() => {
  const file = document.getElementById('import-file');
  const text = document.getElementById('import-text');
  if (!file || !text) return;
  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    text.value = await chosen.text();
  });
})();
