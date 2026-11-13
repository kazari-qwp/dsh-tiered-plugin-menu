for (const button of document.querySelectorAll('[data-copy]')) {
  if (!navigator.clipboard) continue
  button.hidden = false
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy)
    try {
      await navigator.clipboard.writeText(code.textContent)
      button.textContent = '已复制'
      setTimeout(() => { button.textContent = '复制' }, 1800)
    } catch {
      const range = document.createRange()
      range.selectNodeContents(code)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      button.textContent = '请手动复制'
    }
  })
}
