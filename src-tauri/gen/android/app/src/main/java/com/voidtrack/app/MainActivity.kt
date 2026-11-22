package com.voidtrack.app

import android.os.Bundle
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// TikTok-style: системный статус-бар полностью скрыт, WebView рисуется
// от самого верхнего пикселя экрана без отступов под часы/зарядку.
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    hideBars()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.fitsSystemWindows = false
    webView.setPadding(0, 0, 0, 0)
    webView.post { hideBars() }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideBars()
  }

  override fun onResume() {
    super.onResume()
    hideBars()
  }

  private fun hideBars() {
    window.decorView.post {
      WindowCompat.setDecorFitsSystemWindows(window, false)
      window.decorView.fitsSystemWindows = false
      WindowInsetsControllerCompat(window, window.decorView).apply {
        hide(WindowInsetsCompat.Type.statusBars())
        systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    }
  }
}
