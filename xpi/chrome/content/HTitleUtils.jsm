/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/ctypes.jsm");

Cu.import("chrome://htitle/content/HTitleShare.jsm");
Cu.import("chrome://htitle/content/PrefPageObserver.jsm");
Cu.import("chrome://htitle/content/Libs.jsm");

var EXPORTED_SYMBOLS = ["HTitleUtils"];

var HTitlePrefObserver = {
    register: function() {
        HTitleUtils.prefs.addObserver("", this, false);
    },

    unregister: function() {
        HTitleUtils.prefs.removeObserver("", this);
    },

    observe: function(subject, topic, data) {
        if (topic != "nsPref:changed")
            return;

        switch(data) {
            case "debug":
                HTitleShare.debug = HTitleUtils.prefs.getBoolPref("debug");
                break;
            case "legacy_mode.timeout_check":
                HTitleUtils.timeoutCheck = HTitleUtils.prefs.getIntPref("legacy_mode.timeout_check");
                break;
            case "legacy_mode.timeout_between_changes":
                HTitleUtils.timeoutBetweenChanges = HTitleUtils.prefs.getIntPref("legacy_mode.timeout_between_changes");
                break;
        }
    }
}

var HTitleUtilsPrivate = {
    execute: function(path, args, needWait=true) {
        var file = Cc["@mozilla.org/file/local;1"]
                     .createInstance(Ci.nsIFile);
        file.initWithPath(path);

        var process = Cc["@mozilla.org/process/util;1"]
                        .createInstance(Ci.nsIProcess);
        try {
            process.init(file);
            process.run(needWait, args, args.length);
        }
        catch (error) {
            HTitleUtils.log(error.message, "ERROR");
            return -1;
        }

        if (needWait) {
            HTitleUtils.log("Exit value of " + path + " is \"" + process.exitValue + "\"", "DEBUG");
            return process.exitValue;
        }
        else
            return 0;
    }
}

var HTitleUtils = {
    appInfo: null,
    prefs: null,

    windowControlsLayout: null,
    titlebarActions: null,

    utils: {},

    timeoutCheck: 200, // ms
    timeoutBetweenChanges: 200, // ms

    init: function() {
        this.appInfo = Cc["@mozilla.org/xre/app-info;1"]
                         .getService(Ci.nsIXULAppInfo);

        this.prefs = Cc["@mozilla.org/preferences-service;1"]
                       .getService(Ci.nsIPrefService)
                       .getBranch("extensions.htitle.");
        HTitlePrefObserver.register();

        HTitleShare.debug = this.prefs.getBoolPref("debug");
        this.timeoutCheck = this.prefs.getIntPref("legacy_mode.timeout_check");
        this.timeoutBetweenChanges = this.prefs.getIntPref("legacy_mode.timeout_between_changes");

        HTitleShare.gtkVersion = this.getGtkVersion();
        this.windowControlsLayout = this.getWindowControlsLayout();
        this.titlebarActions = this.getTitlebarActions();
    },

    /* ::::: App info functions ::::: */

    isFirefox: function() {
        return (this.appInfo.ID == "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}");
    },

    isThunderbird: function() {
        return (this.appInfo.ID == "{3550f703-e582-4d05-9a08-453d09bdfdc6}");
    },

    isSeaMonkey: function() {
        return (this.appInfo.ID == "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}");
    },

    /* ::::: Change currentset attribute ::::: */

    addToCurrentset: function(node, id) {
        var currentset = node.getAttribute("currentset");
        if (!currentset)
            currentset = node.getAttribute("defaultset");
        currentset = currentset + (currentset == "" ? "" : ",") + id;
        node.setAttribute("currentset", currentset);
    },

    removeFromCurrentset: function(node, id) {
        var currentset = node.getAttribute("currentset");
        if (!currentset)
            currentset = node.getAttribute("defaultset");
        var re = new RegExp("(^|,)" + id + "($|,)");
        currentset = currentset.replace(re, "$2");
        node.setAttribute("currentset", currentset);
    },

    /* ::::: Toolkit version ::::: */

    getGtkVersion: function() {
        var widget_toolkit;
        if (this.prefs.getPrefType("widget_toolkit") == this.prefs.PREF_STRING) {
            widget_toolkit = this.prefs.getCharPref("widget_toolkit");
        }
        else {
            var xul_runtime = Cc["@mozilla.org/xre/app-info;1"]
                                .getService(Ci.nsIXULRuntime);
            widget_toolkit = xul_runtime.widgetToolkit;
        }
        return (widget_toolkit == "gtk3") ? 3 : 2;
    },

    /* ::::: Use external utilities ::::: */

    findPathToExec: function(name) {
        // Return full path or null. Works like "which $name"

        var file = Cc["@mozilla.org/file/local;1"]
                     .createInstance(Ci.nsIFile);

        var env = Cc["@mozilla.org/process/environment;1"]
                    .getService(Ci.nsIEnvironment);
        var path = env.get("PATH").split(":");

        for (var i = 0; i < path.length; i++) {
            var full_path_to_exec = path[i] + "/" + name;

            file.initWithPath(full_path_to_exec);
            if (file.exists() && file.isExecutable()) {
                this.log("Command \"" + name + "\" was found in \"" + path[i] + "\"", "DEBUG");
                return full_path_to_exec;
            }
        }

        this.log("$PATH = " + path, "DEBUG");
        this.log("Command \"" + name + "\" not found", "ERROR");

        return null;
    },

    checkUtilsAvailable: function(utils) {
        var paths = {};
        for (var i = 0; i < utils.length; i++) {
            var path;
            if (this.utils[utils[i]] === undefined) {
                path = this.findPathToExec(utils[i]);
                this.utils[utils[i]] = path;
            }
            else {
                path = this.utils[utils[i]];
            }
            if (path == null)
                return null;
            paths[utils[i]] = path;
        }
        return paths;
    },

    checkPresenceGnomeShell: function() {
        this.log("Start checking DE", "DEBUG");

        var path = this.checkUtilsAvailable(["pidof"]);

        if (path.pidof) {
            var exitValue = HTitleUtilsPrivate.execute(path.pidof, ["gnome-shell"]);
            return (exitValue == 1 ? 1 : 0);
        }
        else {
            this.log("pidof doesn't exist", "ERROR");
            return 2;
        }
    },

    /* ::::: Native window ::::: */

    changeWindowProperty: function(window, mode, action) {
        var X11 = Libs.open("X11");
        var Gdk = Libs.open("Gdk", HTitleShare.gtkVersion, X11);

        /* Get native window */
        var base_window = window.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIWebNavigation)
                                .QueryInterface(Ci.nsIDocShellTreeItem)
                                .treeOwner
                                .QueryInterface(Ci.nsIInterfaceRequestor)
                                .nsIBaseWindow;
        var native_handle = base_window.nativeHandle;

        var gdk_window = new Gdk.GdkWindow.ptr(ctypes.UInt64(native_handle));
        gdk_window = Gdk.Window.get_toplevel(gdk_window);

        var gdk_display = Gdk.Display.get_default();
        var x11_display = Gdk.X11Display.get_xdisplay(gdk_display);
        if (HTitleShare.gtkVersion == 3) {
            var x11_window = Gdk.X11Window.get_xid(gdk_window);
        }
        else {
            var x11_window = Gdk.X11Window.get_xid(ctypes.cast(gdk_window, Gdk.GdkDrawable.ptr));
        }

        //Gdk.Window.hide(gdk_window);
        if (mode == "always") {
            Gdk.Window.set_decorations(gdk_window, (action == "set") ? Gdk.GDK_DECOR_BORDER : Gdk.GDK_DECOR_ALL);
        }
        else {
            if (HTitleShare.gtkVersion == 3) {
                Gdk.X11Window.set_hide_titlebar_when_maximized(gdk_window, (action == "set"));
            }
            else {
                let x11_property = Gdk.x11_get_xatom_by_name_for_display(gdk_display, "_GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED");
                if (action == "set") {
                    let t = new ctypes.ArrayType(ctypes.uint32_t)(1);
                    t[0] = 1;
                    let x11_data = ctypes.uint32_t.ptr(t);
                    X11.XChangeProperty(x11_display, x11_window, x11_property, X11.XA_CARDINAL, 32, X11.PropModeReplace, x11_data, 1);
                }
                else {
                    X11.XDeleteProperty(x11_display, x11_window, x11_property);
                }
            }
        }
        //Gdk.Window.show(gdk_window);

        Libs.close(Gdk);
        Libs.close(X11);
    },

    setWindowProperty: function(window, mode) {
        try {
            this.changeWindowProperty(window, mode, "set");
        } catch (e) {
            return -1;
        }
        return 0;
    },

    removeWindowProperty: function(window, mode) {
        try {
            this.changeWindowProperty(window, mode, "remove");
        } catch (e) {
            return -1;
        }
        return 0;
    },

    lowerWindow: function(window) {
        var Gdk = Libs.open("Gdk", HTitleShare.gtkVersion);
        var base_window = window.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIWebNavigation)
                                .QueryInterface(Ci.nsIDocShellTreeItem)
                                .treeOwner
                                .QueryInterface(Ci.nsIInterfaceRequestor)
                                .nsIBaseWindow;
        var native_handle = base_window.nativeHandle;
        var gdk_window = new Gdk.GdkWindow.ptr(ctypes.UInt64(native_handle));
        gdk_window = Gdk.Window.get_toplevel(gdk_window);
        Gdk.Window.lower(gdk_window);
        Libs.close(Gdk);
    },

    /* ::::: CSS stylesheets ::::: */

    loadStyle: function(name) {
        var sss = Cc["@mozilla.org/content/style-sheet-service;1"]
                    .getService(Ci.nsIStyleSheetService);
        var io = Cc["@mozilla.org/network/io-service;1"]
                   .getService(Ci.nsIIOService);
        var uri = io.newURI("chrome://htitle/skin/" + name + ".css", null, null);
        if (!sss.sheetRegistered(uri, sss.USER_SHEET))
            sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
    },

    unloadStyle: function(name) {
        var sss = Cc["@mozilla.org/content/style-sheet-service;1"]
                    .getService(Ci.nsIStyleSheetService);
        var io = Cc["@mozilla.org/network/io-service;1"]
                   .getService(Ci.nsIIOService);
        var uri = io.newURI("chrome://htitle/skin/" + name + ".css", null, null);
        if (sss.sheetRegistered(uri, sss.USER_SHEET))
            sss.unregisterSheet(uri, sss.USER_SHEET);
    },

    /* ::::: Preferences ::::: */

    getWindowControlsLayout: function() {
        var layout = ":close"; // It's default for GNOME 3

        if (!this.prefs.getBoolPref("window_controls.get_layout_by_gsettings"))
            return layout;

        try {
            var gsettings = Cc["@mozilla.org/gsettings-service;1"]
                              .getService(Ci.nsIGSettingsService);
        } catch(e) {
            this.log("GSettings isn't available", "WARNING");
            return layout;
        }

        var button_layout;
        var keys = ["org.gnome.shell.overrides", "org.gnome.desktop.wm.preferences"];
        for (let i=0; i<keys.length; i++) {
            try {
                button_layout = gsettings.getCollectionForSchema(keys[i])
                                         .getString("button-layout");
                this.log(keys[i] + ".button-layout = '" + button_layout + "'", "DEBUG");
                break;
            } catch(e) {
                continue;
            }
        }

        if (!button_layout) {
            this.log("Cann't get value from GSettings", "WARNING");
            return layout;
        }
        else if (/^([a-zA-Z0-9:,]*)$/.test(button_layout)) {
            layout = button_layout;
        }
        return layout;
    },

    getTitlebarActions: function() {
        var actions = {double: "toggle-maximize",
                       middle: "lower",
                       right:  "menu"}; // It's default for GNOME 3

        if (!this.prefs.getBoolPref("titlebar.get_actions_by_gsettings"))
            return actions;

        try {
            let gsettings = Cc["@mozilla.org/gsettings-service;1"]
                              .getService(Ci.nsIGSettingsService)
                              .getCollectionForSchema("org.gnome.desktop.wm.preferences");

            actions.double = gsettings.getString("action-double-click-titlebar");
            actions.middle = gsettings.getString("action-middle-click-titlebar");
            actions.right = gsettings.getString("action-right-click-titlebar");

            this.log("org.gnome.desktop.wm.preferences.action-double-click-titlebar = '" + actions.double + "'", "DEBUG");
            this.log("org.gnome.desktop.wm.preferences.action-middle-click-titlebar = '" + actions.middle + "'", "DEBUG");
            this.log("org.gnome.desktop.wm.preferences.action-right-click-titlebar = '" + actions.right + "'", "DEBUG");
        } catch(e) {
            this.log("GSettings isn't available", "WARNING");
            return actions;
        }

        return actions;
    },

    /* ::::: Logging ::::: */

    log: function(message, level="ERROR") {
        if (HTitleShare.debug == false && level == "DEBUG")
            return;

        var console = Cc["@mozilla.org/consoleservice;1"]
                        .getService(Ci.nsIConsoleService);

        var flag;
        switch (level) {
            case "ERROR":
                flag = 0;
                break;
            case "WARNING":
                flag = 1;
                break;
            default:
                flag = 4;
        }

        if (flag == 4) {
            console.logStringMessage("HTitle DEBUG: " + message);
        }
        else {
            var console_message = Cc["@mozilla.org/scripterror;1"]
                                    .createInstance(Ci.nsIScriptError);
            console_message.init(message, "HTitle", null, null, null, flag, null);
            console.logMessage(console_message);
        }
    },
}

HTitleUtils.init();
