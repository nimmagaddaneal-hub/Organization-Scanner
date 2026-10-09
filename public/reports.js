// Sets the width of each bar in the reports (inline styles are not allowed by the site's security rules).
document.querySelectorAll('.bar-fill[data-w]').forEach((bar) => {
  bar.style.width = `${bar.dataset.w}%`;
});
document.querySelectorAll('select[data-autosubmit]').forEach((select) => {
  select.addEventListener('change', () => select.form.submit());
});
