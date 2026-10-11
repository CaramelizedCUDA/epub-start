package com.epubstart.reader

import android.os.Bundle
import android.graphics.Color
import android.content.res.Configuration
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var presentationView: WebView? = null
  private var drawObserver: ViewTreeObserver? = null
  private var resumed = false
  private var pending = false
  private var evaluating = false
  // 每次求值的代号；暂停或超时后旧回调即失效，避免丢失的回调永久阻塞同步。
  private var evaluation = 0
  private var dirty = false
  private var lastCheck = 0L
  private var lastDark: Boolean? = null

  // 只在实际绘制、Insets 或生命周期变化时合并检查；静止页面没有常驻定时器。
  private val syncTask = Runnable {
    pending = false
    syncPresentation()
  }
  private val drawListener = ViewTreeObserver.OnDrawListener { scheduleSync() }
  private val attachListener = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) {
      drawObserver = view.viewTreeObserver
      drawObserver?.addOnDrawListener(drawListener)
      ViewCompat.requestApplyInsets(view)
      scheduleSync()
    }
    override fun onViewDetachedFromWindow(view: View) {
      removeDrawListener()
      view.removeCallbacks(syncTask)
      pending = false
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    presentationView = webView
    // 此时 Wry 尚未加载应用页、装载 Client 或 attach；保留其协议与导航处理器。
    webView.addOnAttachStateChangeListener(attachListener)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      scheduleSync()
      insets
    }
  }

  override fun onResume() {
    super.onResume()
    resumed = true
    lastDark = null
    presentationView?.let { ViewCompat.requestApplyInsets(it) }
    scheduleSync()
  }

  override fun onPause() {
    resumed = false
    presentationView?.removeCallbacks(syncTask)
    pending = false
    evaluating = false
    evaluation++
    super.onPause()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    lastDark = null
    presentationView?.let { ViewCompat.requestApplyInsets(it) }
    scheduleSync()
  }

  private fun removeDrawListener() {
    drawObserver?.let { if (it.isAlive) it.removeOnDrawListener(drawListener) }
    drawObserver = null
  }

  override fun onDestroy() {
    resumed = false
    removeDrawListener()
    presentationView?.let {
      it.removeCallbacks(syncTask)
      it.removeOnAttachStateChangeListener(attachListener)
      ViewCompat.setOnApplyWindowInsetsListener(it, null)
    }
    presentationView = null
    super.onDestroy()
  }

  private fun scheduleSync() {
    val view = presentationView ?: return
    if (!resumed || !view.isAttachedToWindow) return
    dirty = true
    if (pending) return
    // 渲染进程重建等情况下回调可能永不返回；超时后允许下一次绘制重新求值。
    if (evaluating && SystemClock.uptimeMillis() - lastCheck < EVALUATION_TIMEOUT_MS) return
    pending = true
    // 动画连续绘制时最多约每 250ms 采样一次；异步回调只在有新绘制时尾随一次。
    view.postDelayed(syncTask, (250L - (SystemClock.uptimeMillis() - lastCheck)).coerceAtLeast(0L))
  }

  private fun syncPresentation() {
    val view = presentationView ?: return
    if (!resumed || !view.isAttachedToWindow || view.width <= 0) return
    dirty = false
    val safe = ViewCompat.getRootWindowInsets(view)?.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
        WindowInsetsCompat.Type.mandatorySystemGestures()
    ) ?: return
    val decor = window.decorView
    val webPosition = IntArray(2)
    val decorPosition = IntArray(2)
    view.getLocationInWindow(webPosition)
    decor.getLocationInWindow(decorPosition)
    // 仅传 WebView 实际被覆盖的部分，已避开系统栏的布局不会重复留白。
    val left = (safe.left - (webPosition[0] - decorPosition[0])).coerceAtLeast(0)
    val top = (safe.top - (webPosition[1] - decorPosition[1])).coerceAtLeast(0)
    val right = (safe.right - (decorPosition[0] + decor.width - webPosition[0] - view.width)).coerceAtLeast(0)
    val bottom = (safe.bottom - (decorPosition[1] + decor.height - webPosition[1] - view.height)).coerceAtLeast(0)
    val token = ++evaluation
    evaluating = true
    lastCheck = SystemClock.uptimeMillis()
    // 固定数值只写顶层展示变量；没有新增可由 EPUB 调用的原生通信入口。
    view.evaluateJavascript("""
      (() => {
        if (!['http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420'].includes(location.origin)) return null;
        const scale = innerWidth / ${view.width};
        if (!Number.isFinite(scale) || scale <= 0) return null;
        let changed = false;
        for (const [side, pixels] of Object.entries({left:$left,top:$top,right:$right,bottom:$bottom})) {
          const name = '--reader-safe-' + side;
          const value = 'max(env(safe-area-inset-' + side + ',0px),' + (pixels * scale).toFixed(4) + 'px)';
          if (document.documentElement.style.getPropertyValue(name) !== value) {
            document.documentElement.style.setProperty(name, value);
            changed = true;
          }
        }
        // 只有 Insets 几何改变才走现有串行重排；工具显隐和主题采样不触发它。
        if (changed) window.dispatchEvent(new Event('resize'));
        return document.querySelector('.reader-shell[data-reader-theme]')?.getAttribute('data-reader-theme') || 'shelf';
      })()
    """.trimIndent()) { result ->
      if (token != evaluation) return@evaluateJavascript
      evaluating = false
      if (presentationView !== view || !resumed) return@evaluateJavascript
      val dark = when (result) {
        "\"dark\"" -> true
        "\"light\"", "\"sepia\"", "\"shelf\"" -> false
        else -> null
      }
      if (dark != null && dark != lastDark) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
        lastDark = dark
      }
      if (dirty) scheduleSync()
    }
  }

  private companion object {
    const val EVALUATION_TIMEOUT_MS = 2000L
  }
}
