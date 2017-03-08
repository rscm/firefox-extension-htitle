/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("chrome://htitle/content/X11.jsm");
Cu.import("chrome://htitle/content/Gdk.jsm");

var EXPORTED_SYMBOLS = ["Libs"];

var Libs = {
    open: function(lib_name) {
        // Example:
        //   var Gdk = Libs.open("Gdk", 2, X11);

        if (!lib_name)
            throw "Libraries is not specified";

        var args = Array.slice(arguments, 1);

        switch (lib_name) {
            case "X11":
                var x11 = new X11;
                return x11;
            case "Gdk":
                var gdk = new Gdk(args[0], args[1]); // version, X11
                return gdk;
        }
    },

    close: function(lib) {
        lib.close();
    }
}
