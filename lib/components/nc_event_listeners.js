var EVT = require('./constants.js').UPSTREAM_EVENTS;
var listeners = {};

// all 'this' in the fuctions will be bound to freebird
listeners.ncError = function (err) {
    // err, err.info = { netcore: ncName }
    this._emitws(EVT.ERROR, err);
};

listeners.ncPermitJoin = function (msg) {
    // { netcore: nc, timeLeft: ticks }
    var nc = msg.netcore,
        ncName = nc.getName();

    this._emitws(EVT.PERMIT_JOIN, err);
};

listeners.ncStarted = function (msg) {
    // { netcore: nc }

    this._emitws(EVT.STARTED, err);
};

listeners.ncStopped = function (msg) {
    // { netcore: nc }
    this._emitws(EVT.STOPPED, err);
};

listeners.ncEnabled = function (msg) {
    // { netcore: nc }
    this._emitws(EVT.ENABLED, err);
};

listeners.ncDisabled = function (msg) {
    // { netcore: nc }
    this._emitws(EVT.DISABLED, err);
};

/***********************************************************************/
/*** tackle device and gadget incoming, leaving, and reporting       ***/
/***********************************************************************/
listeners.ncDevIncoming = function (msg) {
    // { netcore: nc, permAddr: permAddr, raw: rawDev }
    var fb = this,
        nc = msg.netcore,
        ncName = nc.getName(),
        dev = this.findDevByAddr(ncName, msg.permAddr),
        devIn = new Device(nc, msg.raw),
        fbMsg = { dev: null },
        wsMsg = { netcore: ncName, id: null, data: msg.data };

    nc.cookRawDevice(devIn, msg.raw, function (err, ripeDev) {
        devIn = ripeDev;
        devIn.setNetInfo({ status: 'online' });

        if (dev) {
            dev._poke();
            dev._setRawDev(devIn.getRawDev());
            dev.setNetInfo(devIn.getNetInfo());
            dev.setAttrs(devIn.getAttrs());
            dev.extra = devIn.extra;
            dev.setNetInfo({ status: 'online' });
        } else {
            fb.registerDev(devIn, function (err, id) {
                if (err) {
                    devIn = null;
                    fb._emitws(EVT.ERROR, err);
                } else {
                    devIn._poke();
                    fbMsg.dev = devIn;
                    wsMsg.id = devIn.getId();
                    wsMsg.data = devIn._dumpDevInfo();
                    fb._emitws(EVT.DEV_INCOMING, fbMsg, wsMsg);
                }
            });
        }
    });
};

listeners.ncDevLeaving = function (msg) {
    // { netcore: nc, permAddr: permAddr }
    var fb = this,
        ncName = msg.netcore.getName(),
        dev = this.findDevByAddr(ncName, msg.permAddr),
        fbMsg = { id: null },
        wsMsg = { netcore: ncName, id: null };

    if (dev) {
        dev._poke();
        fbMsg.id = wsMsg.id = dev.getId();
        dev.setNetInfo({ status: 'offline' }); // 'netChanged', 'statusChanged'

        if (dev._removing) {
            dev.getGadTable().forEach(function (rec) {  // unregister all gadgets
                var gad = fb.findGadById(rec.gadId);
                if (gad)
                    gad._fbEmit('_nc:gadLeaving');
            });

            fb.unregisterDev(dev, function (err) {      // unregister device
                if (err)
                    fb._emitws(EVT.ERROR, err);
                else
                    fb._emitws(EVT.DEV_LEAVING, fbMsg, wsMsg);
            });
        }
    }
};

listeners.ncGadIncoming = function (msg) {
    // { netcore: nc, permAddr: permAddr, auxId: auxId, raw: rawGad }
    var fb = this,
        nc = msg.netcore,
        ncName = nc.getName(),
        dev = this.findDevByAddr(ncName, msg.permAddr),
        gad = this.findGadByAddrAuxId(ncName, msg.permAddr, msg.auxId),
        gadIn,
        fbMsg = { gad: null },
        wsMsg = { netcore: ncName, id: null, data: null};

    if (dev) {
        dev._poke();
        gadIn = new Gadget(dev, msg.auxId, msg.raw);
        dev.setNetInfo({ status: 'online' });
    } else {
        return; // device not found, ignore this gad incoming
    }

    nc.cookRawGad(gadIn, msg.raw, function (err, newGad) {
        gadIn = newGad;
        if (gad) {
            gad._setRawGad(gadIn.getRawGad());
            gad.setPanelInfo(gadIn.getPanelInfo()); // 'attrsChanged'
            gad.setAttrs(gadIn.getAttrs());         // 'attrsChanged'
            gad.extra = gadIn.extra;
        } else {
            fbMsg.gad = gadIn;
            wsMsg.id = gadIn.getId();
            wsMsg.data = gadIn._dumpGadInfo();

            fb.registerGad(gadIn, function () {
                fb._emitws(EVT.GAD_INCOMING, fbMsg, wsMsg);
            });
        }
    });
};

// internal event
listeners.ncGadLeaving = function (msg) {
    // { gad: gad }
    var fb = this,
        ncName = msg.netcore.getName(),
        gadId = msg.gad.getId(),
        fbMsg = { id: gadId },
        wsMsg = { netcore: ncName, id: gadId };

    // if fail?

    this.unregisterGad(msg.gad, function (err) {
        if (err)
            fb._emitws(EVT.ERROR, err);
        else
            fb._emitws(EVT.GAD_LEAVING, fbMsg, wsMsg);
    });
};

listeners.ncDevReporting = function (msg) {
    // { netcore: nc, permAddr: permAddr, data: devAttrs }
    var ncName = msg.netcore.getName(),
        dev = this.findDevByAddr(ncName, msg.permAddr),
        fbMsg = { dev: null, data: msg.data },
        wsMsg = { netcore: ncName, id: null, data: msg.data };

    if (dev) {
        fbMsg.dev = dev;
        wsMsg.id = dev.getId();
        dev._poke();
        dev.setAttrs(msg.data);     // 'attrsChanged'
        dev.setNetInfo({ status: 'online' });
        this._emitws(EVT.DEV_REPORTING, fbMsg, wsMsg);
    }
};

listeners.ncGadReporting = function (msg) {
    // { netcore: nc, permAddr: permAddr, auxId: auxId, data: gadAttrs }
    var ncName = msg.netcore.getName(),
        dev = this.findDevByAddr(ncName, msg.permAddr),
        gad = this.findGadByAddrAuxId(ncName, msg.permAddr, msg.auxId),
        fbMsg = { gad: null, data: msg.data },
        wsMsg = { netcore: ncName, id: null, data: msg.data };

    if (dev) {
        dev._poke();
        dev.setNetInfo({ status: 'online' });
    }

    if (gad) {
        fbMsg.gad = gad;
        wsMsg.id = gad.getId();
        gad.setAttrs(msg.data);     // 'attrsChanged'
        this._emitws(EVT.GAD_REPORTING, fbMsg, wsMsg);
    }
};

/***********************************************************************/
/*** tackle banned device and gadget events                          ***/
/***********************************************************************/
listeners.ncBannedDevIncoming = function (msg) {
    return bannedComponent(this, 'dev', 'bannedIncoming', msg);
};

listeners.ncBannedDevReporting = function (msg) {
    return bannedComponent(this, 'dev', 'bannedReport', msg);
};

listeners.ncBannedGadIncoming = function (msg) {
    return bannedComponent(this, 'gad', 'bannedIncoming', msg);
};

listeners.ncBannedGadReporting = function (msg) {
    return bannedComponent(this, 'gad', 'bannedReport', msg);
};

/***********************************************************************/
/*** device and gadget events: instance has been changed             ***/
/***********************************************************************/
listeners.devError = function (msg) {
    // err, err.info = { netcore: ncName, dev: id }
    this._emitws(EVT.ERROR, err);
};

listeners.devNetChanged = function (msg) {
    return updateComponent(this, 'net', 'props', msg, function () {
        if (msg.data.status)    // if has a status (means status changed)
            fb._emitws(EVT.STATUS_CHANGED, msg.data);
    });
};

listeners.devPropsChanged = function (msg) {
    return updateComponent(this, 'dev', 'props', msg);
};

listeners.devAttrsChanged = function (msg) {
    return updateComponent(this, 'dev', 'attrs', msg);
};

listeners.gadPanelChanged = function (msg) {
    return updateComponent(this, 'gad', 'panel', msg);
};

listeners.gadPropsChanged = function (msg) {
    return updateComponent(this, 'gad', 'props', msg);
};

listeners.gadAttrsChanged = function (msg) {
    return updateComponent(this, 'gad', 'attrs', msg);
};

/***********************************************************************/
/*** Private Functions                                               ***/
/***********************************************************************/
function bannedComponent(fb, type, indType, msg, cb) {
    // { netcore: nc, permAddr: permAddr, raw: rawDev }
    // { netcore: nc, permAddr, auxId: auxId, data: gadAttrs }
    var ncName = msg.netcore.getName(),
        permAddr = msg.permAddr,
        fbMsg = { netcore: ncName, permAddr: permAddr },    // +data
        evtName = getBanndedEventName(type, indType),
        component;

    if (type === 'dev') {
        component = fb.findDevByAddr(ncName, permAddr);
        fbMsg.raw = msg.raw;
        if (component)
            fb.unregisterDev(component);
    } else if (type === 'gad') {
        component = fb.findGadByAddrAuxId(ncName, permAddr, msg.auxId);
        fbMsg.auxId = msg.auxId;
        fbMsg.data = msg.data;
        if (component)
            fb.unregisterGad(component);
    }

    fb._emitws(evtName, fbMsg, fbMsg);

    if (cb)
        cb();
}

function getBanndedEventName(type, indType) {
    var evt;

    if (type === 'dev') {
        if (indType === 'bannedReport')
            evt = EVT.DEV_BAN_REPORTING;
        else if (indType === 'bannedIncoming')
            evt = EVT.DEV_BAN_INCOMING;
    } else if (type === 'gad') {
        if (indType === 'bannedReport')
            evt = EVT.GAD_BAN_REPORTING;
        else if (indType === 'bannedIncoming')
            evt = EVT.GAD_BAN_INCOMING;
    }
    return evt;
}

function updateComponent(fb, type, namespace, msg, cb) {
    // type = 'dev', msg: { netcore: nc, dev: dev, data: delta }
    // type = 'gad' ,msg: { netcore: nc, gad: gad, data: delta }
    var ncName = msg.netcore.getName(),
        id,
        delta = msg.data,
        fbMsg = { data: delta },                     // + dev or gad
        wsMsg = { netcore: ncName, data: delta },    // + id: devId or gadId,
        evtName = getUpdateEventName(type, namespace),
        box;

    if (type === 'dev') {
        fbMsg.dev = msg.dev;
        id = wsMsg.id = msg.dev.getId();
        box = fb._devbox;
    } else if (type === 'gad') {
        msg.gad.getDev();
        fbMsg.gad = msg.gad;
        id = wsMsg.id = msg.gad.getId();
        box = fb._gadbox;
    }

    box.update(id, namespace, delta, function (err, diff) {
        if (err)
            fb._emitws(EVT.ERROR, err);

        fb._emitws(evtName, fbMsg, wsMsg);   // instance always been changed
        if (cb)
            cb();
    });
}

function getUpdateEventName(type, namespace) {
    var evtName;

    if (type === 'dev') {
        if (namespace === 'net')
            evtName = EVT.NET_CHANGED;
        else if (namespace === 'props')
            evtName = EVT.DEV_PROPS_CHANGED;
        else if (namespace === 'attrs')
            evtName = EVT.DEV_ATTRS_CHANGED;
    } else if (type === 'gad') {
        if (namespace === 'panel')
            evtName = EVT.PANEL_CHANGED;
        else if (namespace === 'props')
            evtName = EVT.GAD_PROPS_CHANGED;
        else if (namespace === 'attrs')
            evtName = EVT.GAD_ATTRS_CHANGED;
    }

    return evtName;
}

module.exports = listeners;