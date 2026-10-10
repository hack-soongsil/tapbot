package com.tapbot.agent.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UiElementClickerTest {
    @Test fun clicksOffscreenNodeWithoutUsingBoundsAndRecycles() {
        val target = ClickNode(text = "Next", clickable = true, visibleToUser = false)
        val root = ClickNode(packageName = "example", children = listOf(target))
        assertEquals(UiClickOutcome.CLICKED, UiElementClicker().click(root, UiClickSelector(text = "Next", packageName = "example")))
        assertEquals(1, target.clicks)
        assertTrue(root.recycled && target.recycled)
    }

    @Test fun resolvesTextChildToClosestClickableAncestorOnlyOnce() {
        val label = ClickNode(text = "Next")
        val button = ClickNode(clickable = true, children = listOf(label))
        val root = ClickNode(children = listOf(button))
        assertEquals(UiClickOutcome.CLICKED, UiElementClicker().click(root, UiClickSelector(text = "Next")))
        assertEquals(1, button.clicks)
        assertEquals(0, label.clicks)
    }

    @Test fun ambiguousDisabledPasswordAndTruncatedTreesDispatchNoAction() {
        val first = ClickNode(text = "Next", clickable = true)
        val second = ClickNode(text = "Next", clickable = true)
        assertEquals(UiClickOutcome.AMBIGUOUS, UiElementClicker().click(ClickNode(children = listOf(first, second)), UiClickSelector(text = "Next")))
        assertEquals(0, first.clicks + second.clicks)
        val disabled = ClickNode(text = "Next", clickable = true, enabled = false)
        val secret = ClickNode(text = "Next", clickable = true, password = true)
        assertEquals(UiClickOutcome.NOT_FOUND, UiElementClicker().click(ClickNode(children = listOf(disabled, secret)), UiClickSelector(text = "Next")))
        assertEquals(0, disabled.clicks + secret.clicks)
        val hiddenDuplicate = ClickNode(text = "Next", clickable = true)
        assertEquals(UiClickOutcome.TRUNCATED, UiElementClicker(maxNodes = 2).click(ClickNode(children = listOf(first, hiddenDuplicate)), UiClickSelector(text = "Next")))
        assertEquals(0, first.clicks + hiddenDuplicate.clicks)
    }

    @Test fun screenGuardAndRejectedActionNeverRetry() {
        val target = ClickNode(text = "Next", clickable = true, accepted = false)
        assertEquals(UiClickOutcome.WRONG_SCREEN, UiElementClicker().click(ClickNode(children = listOf(target)), UiClickSelector(text = "Next", requiredText = "Details")))
        assertEquals(0, target.clicks)
        assertEquals(UiClickOutcome.REJECTED, UiElementClicker().click(ClickNode(children = listOf(target)), UiClickSelector(text = "Next")))
        assertEquals(1, target.clicks)
    }
}

private class ClickNode(
    override val text: String? = null,
    override val clickable: Boolean = false,
    override val enabled: Boolean = true,
    override val visibleToUser: Boolean = true,
    override val password: Boolean = false,
    override val packageName: String? = null,
    private val accepted: Boolean = true,
    private val children: List<ClickNode> = emptyList(),
) : UiNodeSource {
    override val className: String? = null
    override val contentDescription: String? = null
    override val viewIdResourceName: String? = null
    override val bounds = UiBounds(0, 0, 0, 0)
    override val focusable = false
    override val focused = false
    override val selected = false
    override val checked = false
    override val checkable = false
    override val scrollable = false
    override val editable = false
    override val childCount get() = children.size
    var clicks = 0
    var recycled = false
    override fun child(index: Int): UiNodeSource = children[index]
    override fun click(): Boolean { clicks++; return accepted }
    override fun recycle() { recycled = true }
}
