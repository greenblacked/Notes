// Keyboard support for folding callouts. The engine's own script folds a callout on click only;
// this adds Enter and Space on the focused title (the button pattern) and keeps aria-expanded in
// step with the fold state. Every listener is delegated on the document, so pages swapped in by
// client-side navigation and popovers need no re-binding. Written in plain ES2015 on purpose: the
// function is serialised into an inline script, so it must not use imports or outer variables.

export function installCalloutFold(doc) {
  if (!doc || !doc.addEventListener || doc.__calloutFold) return
  doc.__calloutFold = true

  var SELECTOR = ".callout.is-collapsible > .callout-title"
  var pendingSpace = null

  function titleOf(event) {
    var target = event.target
    if (!target || !target.closest) return null
    var title = target.closest(SELECTOR)
    return title && title === target ? title : null
  }

  function isSpace(event) {
    return event.key === " " || event.key === "Spacebar"
  }

  doc.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
    var title = titleOf(event)
    if (!title) return
    if (event.key === "Enter") {
      event.preventDefault()
      if (!event.repeat) title.click()
    } else if (isSpace(event)) {
      // Keep the page from scrolling; the toggle happens on keyup, like a native button.
      event.preventDefault()
      pendingSpace = title
    }
  })

  doc.addEventListener("keyup", function (event) {
    if (!isSpace(event)) return
    var title = titleOf(event)
    var armed = pendingSpace
    pendingSpace = null
    if (title && title === armed) title.click()
  })

  // Bubbling, so this runs after the engine's listener on the title has toggled the class.
  doc.addEventListener("click", function (event) {
    var target = event.target
    if (!target || !target.closest) return
    var title = target.closest(SELECTOR)
    if (!title || !title.parentElement) return
    var collapsed = title.parentElement.classList.contains("is-collapsed")
    title.setAttribute("aria-expanded", String(!collapsed))
  })
}

export const FOLD_SCRIPT = "(" + installCalloutFold.toString() + ")(document);"
