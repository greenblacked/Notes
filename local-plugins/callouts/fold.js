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

  // Old iOS Safari (before 10.3) and old Android WebViews send keyCode only.
  function isEnter(event) {
    return event.key === "Enter" || (!event.key && event.keyCode === 13)
  }

  function isSpace(event) {
    return event.key === " " || event.key === "Spacebar" || (!event.key && event.keyCode === 32)
  }

  doc.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
    var title = titleOf(event)
    if (!title) return
    if (isEnter(event)) {
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

  // The engine's script binds its click toggle only on page navigation, so a callout added later
  // (a link popover) has no listener and would never fold. Record the state in the capture phase,
  // before any listener on the title runs; in the bubble phase, if nothing changed it, fold here.
  // A callout the engine did toggle is left alone, so it never folds twice.
  var before = null

  doc.addEventListener(
    "click",
    function (event) {
      var title = event.target && event.target.closest && event.target.closest(SELECTOR)
      before =
        title && title.parentElement
          ? { title: title, collapsed: title.parentElement.classList.contains("is-collapsed") }
          : null
    },
    true,
  )

  doc.addEventListener("click", function (event) {
    var state = before
    before = null
    var target = event.target
    if (!target || !target.closest) return
    var title = target.closest(SELECTOR)
    if (!title || !title.parentElement) return
    var block = title.parentElement
    if (
      state &&
      state.title === title &&
      block.classList.contains("is-collapsed") === state.collapsed
    ) {
      block.classList.toggle("is-collapsed")
      var content = block.querySelector(":scope > .callout-content")
      if (content && content.style) {
        content.style.gridTemplateRows = state.collapsed ? "1fr" : "0fr"
      }
    }
    var collapsed = block.classList.contains("is-collapsed")
    title.setAttribute("aria-expanded", String(!collapsed))
  })
}

export const FOLD_SCRIPT = "(" + installCalloutFold.toString() + ")(document);"
