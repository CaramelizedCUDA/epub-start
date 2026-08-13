package com.epubstart.reader

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class UriArgs {
    lateinit var sourceLocator: String
}

@TauriPlugin
class EpubSafPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pickEpub(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/epub+zip", "application/zip", "application/octet-stream"),
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickEpubResult")
    }

    @ActivityCallback
    fun pickEpubResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(JSObject().apply { put("cancelled", true) })
            return
        }
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Android document picker failed")
            return
        }

        val uri = result.data?.data
        if (uri == null) {
            invoke.reject("Android document picker returned no URI")
            return
        }

        try {
            val returnedFlags = result.data?.flags ?: 0
            if (returnedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) {
                invoke.reject("Document provider did not grant read permission")
                return
            }
            activity.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
            invoke.resolve(JSObject().apply {
                put("cancelled", false)
                put("sourceLocator", uri.toString())
            })
        } catch (error: SecurityException) {
            invoke.reject("Could not persist document read permission")
        }
    }

    @Command
    fun inspectUri(invoke: Invoke) {
        val uri = parsePersistedUri(invoke) ?: return
        try {
            var size = 0L
            var lastModified = 0L
            activity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (!cursor.moveToFirst()) {
                    invoke.reject("Document provider returned no metadata")
                    return
                }
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    size = cursor.getLong(sizeIndex).coerceAtLeast(0L)
                }
                val modifiedIndex =
                    cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                if (modifiedIndex >= 0 && !cursor.isNull(modifiedIndex)) {
                    lastModified = cursor.getLong(modifiedIndex).coerceAtLeast(0L)
                }
            } ?: run {
                invoke.reject("Document provider is unavailable")
                return
            }

            activity.contentResolver.openFileDescriptor(uri, "r")?.use { }
                ?: run {
                    invoke.reject("Document cannot be opened")
                    return
                }

            invoke.resolve(JSObject().apply {
                put("fileSizeBytes", size)
                put("lastModifiedTs", lastModified)
            })
        } catch (error: Exception) {
            invoke.reject("Document is no longer accessible")
        }
    }

    @Command
    fun openReadFd(invoke: Invoke) {
        val uri = parsePersistedUri(invoke) ?: return
        try {
            val descriptor = activity.contentResolver.openFileDescriptor(uri, "r")
            if (descriptor == null) {
                invoke.reject("Document cannot be opened")
                return
            }
            val fd = descriptor.detachFd()
            descriptor.close()
            invoke.resolve(JSObject().apply { put("fd", fd) })
        } catch (error: Exception) {
            invoke.reject("Document cannot be opened")
        }
    }

    @Command
    fun releasePermission(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(UriArgs::class.java)
        } catch (error: Exception) {
            invoke.reject("Invalid content URI")
            return
        }
        val uri = Uri.parse(args.sourceLocator)
        try {
            activity.contentResolver.releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
            invoke.resolve(JSObject().apply { put("released", true) })
        } catch (error: SecurityException) {
            invoke.resolve(JSObject().apply { put("released", false) })
        }
    }

    private fun parsePersistedUri(invoke: Invoke): Uri? {
        val args = try {
            invoke.parseArgs(UriArgs::class.java)
        } catch (error: Exception) {
            invoke.reject("Invalid content URI")
            return null
        }
        val uri = Uri.parse(args.sourceLocator)
        if (uri.scheme != "content") {
            invoke.reject("Source is not a content URI")
            return null
        }
        val hasPermission = activity.contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission
        }
        if (!hasPermission) {
            invoke.reject("Persisted read permission is missing")
            return null
        }
        return uri
    }
}
