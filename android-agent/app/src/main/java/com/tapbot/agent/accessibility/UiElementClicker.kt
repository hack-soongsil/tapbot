package com.tapbot.agent.accessibility

data class UiClickSelector(
    val viewId: String? = null,
    val text: String? = null,
    val contentDescription: String? = null,
    val nodePath: String? = null,
    val packageName: String? = null,
    val requiredText: String? = null,
) {
    init {
        require(listOf(viewId, text, contentDescription, nodePath).any { !it.isNullOrBlank() })
        require(nodePath == null || Regex("n0(\\.\\d+)*").matches(nodePath))
    }

    fun matches(node: UiNodeSource, path: String): Boolean =
        !node.password && node.enabled &&
            (nodePath == null || path == nodePath) &&
            (viewId == null || node.viewIdResourceName == viewId) &&
            (text == null || node.text == text) &&
            (contentDescription == null || node.contentDescription == contentDescription)
}

enum class UiClickOutcome { CLICKED, NOT_FOUND, AMBIGUOUS, WRONG_SCREEN, REJECTED, TRUNCATED }

/** Resolve a fresh tree and call ACTION_CLICK once, including offscreen nodes. */
class UiElementClicker(private val maxNodes: Int = 5000, private val maxDepth: Int = 80) {
    fun click(root: UiNodeSource, selector: UiClickSelector): UiClickOutcome {
        val retained = mutableListOf<UiNodeSource>()
        val candidates = linkedMapOf<String, UiNodeSource>()
        var truncated = false
        var screenMatches = selector.requiredText == null
        fun visit(node: UiNodeSource, path: String, depth: Int, ancestor: Pair<String, UiNodeSource>?) {
            retained.add(node)
            if (retained.size > maxNodes || depth > maxDepth) {
                truncated = true
                return
            }
            if (node.text == selector.requiredText && !node.password) screenMatches = true
            val target = if (node.clickable && node.enabled) path to node else ancestor
            if (selector.matches(node, path) && target != null) candidates[target.first] = target.second
            for (index in 0 until node.childCount) {
                if (truncated) break
                node.child(index)?.let { visit(it, "$path.$index", depth + 1, target) }
            }
        }
        try {
            if (selector.packageName != null && root.packageName != selector.packageName)
                return UiClickOutcome.WRONG_SCREEN
            visit(root, "n0", 0, null)
            if (truncated) return UiClickOutcome.TRUNCATED
            if (!screenMatches) return UiClickOutcome.WRONG_SCREEN
            if (candidates.isEmpty()) return UiClickOutcome.NOT_FOUND
            if (candidates.size != 1) return UiClickOutcome.AMBIGUOUS
            return if (candidates.values.single().click()) UiClickOutcome.CLICKED else UiClickOutcome.REJECTED
        } finally {
            if (retained.isEmpty()) root.recycle() else retained.asReversed().forEach { it.recycle() }
        }
    }
}
