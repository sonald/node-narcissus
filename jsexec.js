/* ***** BEGIN LICENSE BLOCK *****
 * vim: set ts=4 sw=4 et tw=80:
 *
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Narcissus - JS implemented in JS.
 *
 * Execution of parse trees.
 *
 * Standard classes except for eval, Function, Array, and String are borrowed
 * from the host JS environment.  Function is metacircular.  Array and String
 * are reflected via wrapping the corresponding native constructor and adding
 * an extra level of prototype-based delegation.
 */

const GLOBAL_CODE = 0, EVAL_CODE = 1, FUNCTION_CODE = 2;

function ExecutionContext(type) {
    this.type = type;
}

var global = {
    // Value properties.
    NaN: NaN, Infinity: Infinity, undefined: undefined,

    // Function properties.
    eval: function eval(s) {
        if (typeof s != "string")
            return s;

        var x = ExecutionContext.current;
        var x2 = new ExecutionContext(EVAL_CODE);
        x2.thisObject = x.thisObject;
        x2.caller = x.caller;
        x2.callee = x.callee;
        x2.scope = x.scope;
        ExecutionContext.current = x2;
        try {
            execute(parse(s), x2);
        } catch (e) {
            if (e == THROW) {
                x.result = x2.result;
                throw e;
            } else {
                throw e;
            }
        } finally {
            ExecutionContext.current = x;
        }
        return x2.result;
    },
    parseInt: parseInt, parseFloat: parseFloat,
    isNaN: isNaN, isFinite: isFinite,
    decodeURI: decodeURI, encodeURI: encodeURI,
    decodeURIComponent: decodeURIComponent,
    encodeURIComponent: encodeURIComponent,

    // Class constructors.  Where ECMA-262 requires C.length == 1, we declare
    // a dummy formal parameter.
    Object: Object,
    Function: function Function(dummy) {
        var p = "", b = "", n = arguments.length;
        if (n) {
            var m = n - 1;
            if (m) {
                p += arguments[0];
                for (var k = 1; k < m; k++)
                    p += "," + arguments[k];
            }
            b += arguments[m];
        }

        // XXX We want to pass a good file and line to the tokenizer.
        // Note the anonymous name to maintain parity with Spidermonkey.
        var t = new Tokenizer("anonymous(" + p + ") {" + b + "}");

        // NB: Use the STATEMENT_FORM constant since we don't want to push this
        // function onto the null compilation context.
        var f = FunctionDefinition(t, null, false, STATEMENT_FORM);
        var s = {object: global, parent: null};
        return new FunctionObject(f, s);
    },
    Array: function Array(dummy) {
        // Array when called as a function acts as a constructor.
        return GLOBAL.Array.apply(this, arguments);
    },
    String: function String(s) {
        // Called as function or constructor: convert argument to string type.
        s = arguments.length ? "" + s : "";
        if (this instanceof String) {
            // Called as constructor: save the argument as the string value
            // of this String object and return this object.
            this.value = s;
            return this;
        }
        return s;
    },
    Boolean: Boolean, Number: Number, Date: Date, RegExp: RegExp,
    Error: Error, EvalError: EvalError, RangeError: RangeError,
    ReferenceError: ReferenceError, SyntaxError: SyntaxError,
    TypeError: TypeError, URIError: URIError,

    // Other properties.
    Math: Math,

    // Extensions to ECMA.
    snarf: snarf, evaluate: evaluate,
    load: function load(s) {
        if (typeof s != "string")
            return s;

        evaluate(snarf(s), s, 1)
    },
    print: print, version: null
};

// Helper to avoid Object.prototype.hasOwnProperty polluting scope objects.
function hasDirectProperty(o, p) {
    return Object.prototype.hasOwnProperty.call(o, p);
}

// Reflect a host class into the target global environment by delegation.
function reflectClass(name, proto) {
    var gctor = global[name];
    //gctor.__defineProperty__('prototype', proto, true, true, true);
    gctor.prototype = proto;
    proto.__defineProperty__('constructor', gctor, false, false, true);
    return proto;
}

// Reflect Array -- note that all Array methods are generic.
reflectClass('Array', new Array);

// Reflect String, overriding non-generic methods.
var gSp = reflectClass('String', new String);
gSp.toSource = function () { return this.value.toSource(); };
gSp.toString = function () { return this.value; };
gSp.valueOf  = function () { return this.value; };
global.String.fromCharCode = String.fromCharCode;

var XCp = ExecutionContext.prototype;
ExecutionContext.current = XCp.caller = XCp.callee = null;
XCp.scope = {object: global, parent: null};
XCp.thisObject = global;
XCp.result = undefined;
XCp.target = null;
XCp.ecmaStrictMode = false;

function Reference(base, propertyName, node) {
    this.base = base;
    this.propertyName = propertyName;
    this.node = node;
}

Reference.prototype.toString = function () { return this.node.getSource(); }

function getValue(v) {
    if (v instanceof Reference) {
        if (!v.base) {
            throw new ReferenceError(v.propertyName + " is not defined",
                                     v.node.filename, v.node.lineno);
        }
        return v.base[v.propertyName];
    }
    return v;
}

function putValue(v, w, vn) {
    if (v instanceof Reference)
        return (v.base || global)[v.propertyName] = w;
    throw new ReferenceError("Invalid assignment left-hand side",
                             vn.filename, vn.lineno);
}

function isPrimitive(v) {
    var t = typeof v;
    return (t == "object") ? v === null : t != "function";
}

function isObject(v) {
    var t = typeof v;
    return (t == "object") ? v !== null : t == "function";
}

// If r instanceof Reference, v == getValue(r); else v === r.  If passed, rn
// is the node whose execute result was r.
function toObject(v, r, rn) {
    switch (typeof v) {
      case "boolean":
        return new global.Boolean(v);
      case "number":
        return new global.Number(v);
      case "string":
        return new global.String(v);
      case "function":
        return v;
      case "object":
        if (v !== null)
            return v;
    }
    var message = r + " (type " + (typeof v) + ") has no properties";
    throw rn ? new TypeError(message, rn.filename, rn.lineno)
             : new TypeError(message);
}

function execute(n, x) {
    var a, f, i, j, r, s, t, u, v;

    if (n.type == FUNCTION) {
        if (n.functionForm != DECLARED_FORM) {
            if (!n.name || n.functionForm == STATEMENT_FORM) {
                v = new FunctionObject(n, x.scope);
                if (n.functionForm == STATEMENT_FORM)
                    x.scope.object.__defineProperty__(n.name, v, true);
            } else {
                t = new Object;
                x.scope = {object:t, parent:x.scope};
                try {
                    v = new FunctionObject(n, x.scope);
                    t.__defineProperty__(n.name, v, true, true);
                } finally {
                    x.scope = x.scope.parent;
                }
            }
        }
    } else if (n.type == SCRIPT) {
        t = x.scope.object;
        a = n.funDecls;
        for (i = 0, j = a.length; i < j; i++) {
            s = a[i].name;
            f = new FunctionObject(a[i], x.scope);
            t.__defineProperty__(s, f, x.type != EVAL_CODE, true);
        }
        a = n.varDecls;
        for (i = 0, j = a.length; i < j; i++) {
            u = a[i];
            s = u.name;
            if (u.readOnly && hasDirectProperty(t, s)) {
                throw new TypeError("Redeclaration of const " + s,
                    u.filename, u.lineno);
            }
            if (u.readOnly || !hasDirectProperty(t, s)) {
                t.__defineProperty__(s, undefined, x.type != EVAL_CODE,
                    u.readOnly);
            }
        }
        for (i = 0, j = n.length; i < j; i++)
            execute(n[i], x);
    } else if (n.type == BLOCK) {
        for (i = 0, j = n.length; i < j; i++)
            execute(n[i], x);
    } else if (n.type == IF) {
        if (getValue(execute(n.condition, x))) {
            execute(n.thenPart, x);
        } else if (n.elsePart) {
            execute(n.elsePart, x);
        }
    } else if (n.type == SWITCH) {
        s = getValue(execute(n.discriminant, x));
        a = n.cases;
        switch_loop:
            for (i = 0, j = a.length; ; i++) {
                if (i == j) {
                    if (n.defaultIndex >= 0) {
                        i = n.defaultIndex - 1; // no case matched, do default
                        matchDefault = true;
                        continue;
                    }
                    break;                      // no default, exit switch_loop
                }
                t = a[i];                       // next case (might be default!)
                if (t.type == CASE) {
                    u = getValue(execute(t.caseLabel, x));
                } else {
                    if (!matchDefault)          // not defaulting, skip for now
                        continue;
                    u = s;                      // force match to do default
                }
                if (u === s) {
                    for (; ;) {                  // this loop exits switch_loop
                        if (t.statements.length) {
                            try {
                                execute(t.statements, x);
                            } catch (e) {
                                if (e == BREAK && x.target == n) {
                                    break switch_loop;
                                } else {
                                    throw e;
                                }
                            }
                        }
                        if (++i == j)
                            break switch_loop;
                        t = a[i];
                    }
                    // NOT REACHED
                }
            }
    } else if (n.type == FOR) {
        n.setup && getValue(execute(n.setup, x));
        while (!n.condition || getValue(execute(n.condition, x))) {
            try {
                execute(n.body, x);
            } catch (e) {
                if (e == BREAK && x.target == n) {
                    break;
                } else {
                    throw e;
                }
            }
            n.update && getValue(execute(n.update, x));
        }
    } else if (n.type == WHILE) {
        while (!n.condition || getValue(execute(n.condition, x))) {
            try {
                execute(n.body, x);
            } catch (e) {
                if (e == BREAK && x.target == n) {
                    break;
                } else if (e == CONTINUE && x.target == n) {
                    continue;
                } else {
                    throw e;
                }
            }
            n.update && getValue(execute(n.update, x));
        }
    } else if (n.type == FOR_IN) {
        u = n.varDecl;
        if (u)
            execute(u, x);
        r = n.iterator;
        s = execute(n.object, x);
        v = getValue(s);
        t = (v == null && !x.ecmaStrictMode) ? v : toObject(v, s, n.object);
        a = [];
        for (i in t)
            a.push(i);
        for (i = 0, j = a.length; i < j; i++) {
            putValue(execute(r, x), a[i], r);
            try {
                execute(n.body, x);
            } catch (e) {
                if (e == BREAK && x.target == n) {
                    break;
                } else if (e == CONTINUE && x.target == n) {
                    continue;
                } else {
                    throw e;
                }
            }
        }
    } else if (n.type == DO) {
        do {
            try {
                execute(n.body, x);
            } catch (e) {
                if (e == BREAK && x.target == n) {
                    break;
                } else if (e == CONTINUE && x.target == n) {
                    continue;
                } else {
                    throw e;
                }
            }

        } while (getValue(execute(n.condition, x)));
    } else if (n.type == BREAK || n.type == CONTINUE) {
        x.target = n.target;
        throw n.type;
    } else if (n.type == TRY) {
        try {
            execute(n.tryBlock, x);
        } catch (e) {
            if (e == THROW && (j = n.catchClauses.length)) {
                e = x.result;
                x.result = undefined;
                for (i = 0; ; i++) {
                    if (i == j) {
                        x.result = e;
                        throw THROW;
                    }
                    t = n.catchClauses[i];
                    x.scope = {object:{}, parent:x.scope};
                    x.scope.object.__defineProperty__(t.varName, e, true);
                    try {
                        if (t.guard && !getValue(execute(t.guard, x)))
                            continue;
                        execute(t.block, x);
                        break;
                    } finally {
                        x.scope = x.scope.parent;
                    }
                }
            }
        } finally {
            if (n.finallyBlock)
                execute(n.finallyBlock, x);
        }
    } else if (n.type == THROW) {
        x.result = getValue(execute(n.exception, x));
        throw THROW;
    } else if (n.type == RETURN) {
        x.result = getValue(execute(n.value, x));
        throw RETURN;
    } else if (n.type == WITH) {
        r = execute(n.object, x);
        t = toObject(getValue(r), r, n.object);
        x.scope = {object:t, parent:x.scope};
        try {
            execute(n.body, x);
        } finally {
            x.scope = x.scope.parent;
        }
    } else if (n.type == VAR || n.type == CONST) {
        for (i = 0, j = n.length; i < j; i++) {
            u = n[i].initializer;
            if (!u)
                continue;
            t = n[i].name;
            for (s = x.scope; s; s = s.parent) {
                if (hasDirectProperty(s.object, t))
                    break;
            }
            u = getValue(execute(u, x));
            if (n.type == CONST)
                s.object.__defineProperty__(t, u, x.type != EVAL_CODE, true);
            else
                s.object[t] = u;
        }
    } else if (n.type == DEBUGGER) {
        throw "NYI: " + tokens[n.type];
    } else if (n.type == SEMICOLON) {
        if (n.expression)
            x.result = getValue(execute(n.expression, x));
    } else if (n.type == LABEL) {
        try {
            execute(n.statement, x);
            //Sian: REWRITE: } catch (e if e == BREAK && x.target == n) {
        } catch (e) {
            if (e == BREAK && x.target == n) {
            } else {
                throw e;
            }
        }
    } else if (n.type == COMMA) {
        for (i = 0, j = n.length; i < j; i++)
            v = getValue(execute(n[i], x));
    } else if (n.type == ASSIGN) {
        r = execute(n[0], x);
        t = n[0].assignOp;
        if (t)
            u = getValue(r);
        v = getValue(execute(n[1], x));
        if (t) {
            switch (t) {
                case BITWISE_OR:
                    v = u | v;
                    break;
                case BITWISE_XOR:
                    v = u ^ v;
                    break;
                case BITWISE_AND:
                    v = u & v;
                    break;
                case LSH:
                    v = u << v;
                    break;
                case RSH:
                    v = u >> v;
                    break;
                case URSH:
                    v = u >>> v;
                    break;
                case PLUS:
                    v = u + v;
                    break;
                case MINUS:
                    v = u - v;
                    break;
                case MUL:
                    v = u * v;
                    break;
                case DIV:
                    v = u / v;
                    break;
                case MOD:
                    v = u % v;
                    break;
            }
        }
        putValue(r, v, n[0]);
    } else if (n.type == HOOK) {
        v = getValue(execute(n[0], x)) ? getValue(execute(n[1], x))
            : getValue(execute(n[2], x));
    } else if (n.type == OR) {
        v = getValue(execute(n[0], x)) || getValue(execute(n[1], x));
    } else if (n.type == AND) {
        v = getValue(execute(n[0], x)) && getValue(execute(n[1], x));
    } else if (n.type == BITWISE_OR) {
        v = getValue(execute(n[0], x)) | getValue(execute(n[1], x));
    } else if (n.type == BITWISE_XOR) {
        v = getValue(execute(n[0], x)) ^ getValue(execute(n[1], x));
    } else if (n.type == BITWISE_AND) {
        v = getValue(execute(n[0], x)) & getValue(execute(n[1], x));
    } else if (n.type == EQ) {
        v = getValue(execute(n[0], x)) == getValue(execute(n[1], x));
    } else if (n.type == NE) {
        v = getValue(execute(n[0], x)) != getValue(execute(n[1], x));
    } else if (n.type == STRICT_EQ) {
        v = getValue(execute(n[0], x)) === getValue(execute(n[1], x));
    } else if (n.type == STRICT_NE) {
        v = getValue(execute(n[0], x)) !== getValue(execute(n[1], x));
    } else if (n.type == LT) {
        v = getValue(execute(n[0], x)) < getValue(execute(n[1], x));
    } else if (n.type == LE) {
        v = getValue(execute(n[0], x)) <= getValue(execute(n[1], x));
    } else if (n.type == GE) {
        v = getValue(execute(n[0], x)) >= getValue(execute(n[1], x));
    } else if (n.type == GT) {
        v = getValue(execute(n[0], x)) > getValue(execute(n[1], x));
    } else if (n.type == IN) {
        v = getValue(execute(n[0], x)) in getValue(execute(n[1], x));
    } else if (n.type == INSTANCEOF) {
        t = getValue(execute(n[0], x));
        u = getValue(execute(n[1], x));
        if (isObject(u) && typeof u.__hasInstance__ == "function")
            v = u.__hasInstance__(t);
        else
            v = t instanceof u;
    } else if (n.type == LSH) {
        v = getValue(execute(n[0], x)) << getValue(execute(n[1], x));
    } else if (n.type == RSH) {
        v = getValue(execute(n[0], x)) >> getValue(execute(n[1], x));
    } else if (n.type == URSH) {
        v = getValue(execute(n[0], x)) >>> getValue(execute(n[1], x));
    } else if (n.type == PLUS) {
        v = getValue(execute(n[0], x)) + getValue(execute(n[1], x));
    } else if (n.type == MINUS) {
        v = getValue(execute(n[0], x)) - getValue(execute(n[1], x));
    } else if (n.type == MUL) {
        v = getValue(execute(n[0], x)) * getValue(execute(n[1], x));
    } else if (n.type == DIV) {
        v = getValue(execute(n[0], x)) / getValue(execute(n[1], x));
    } else if (n.type == MOD) {
        v = getValue(execute(n[0], x)) % getValue(execute(n[1], x));
    } else if (n.type == DELETE) {
        t = execute(n[0], x);
        v = !(t instanceof Reference) || delete t.base[t.propertyName];
    } else if (n.type == VOID) {
        getValue(execute(n[0], x));
    } else if (n.type == TYPEOF) {
        t = execute(n[0], x);
        if (t instanceof Reference)
            t = t.base ? t.base[t.propertyName] : undefined;
        v = typeof t;
    } else if (n.type == NOT) {
        v = !getValue(execute(n[0], x));
    } else if (n.type == BITWISE_NOT) {
        v = ~getValue(execute(n[0], x));
    } else if (n.type == UNARY_PLUS) {
        v = +getValue(execute(n[0], x));
    } else if (n.type == UNARY_MINUS) {
        v = -getValue(execute(n[0], x));
    } else if (n.type == INCREMENT || n.type == DECREMENT) {
        t = execute(n[0], x);
        u = Number(getValue(t));
        if (n.postfix)
            v = u;
        putValue(t, (n.type == INCREMENT) ? ++u : --u, n[0]);
        if (!n.postfix)
            v = u;
    } else if (n.type == DOT) {
        r = execute(n[0], x);
        t = getValue(r);
        u = n[1].value;
        v = new Reference(toObject(t, r, n[0]), u, n);
    } else if (n.type == INDEX) {
        r = execute(n[0], x);
        t = getValue(r);
        u = getValue(execute(n[1], x));
        v = new Reference(toObject(t, r, n[0]), String(u), n);
    } else if (n.type == LIST) {
        v = {};
        for (i = 0, j = n.length; i < j; i++) {
            u = getValue(execute(n[i], x));
            v.__defineProperty__(i, u, false, false, true);
        }
        v.__defineProperty__('length', i, false, false, true);
    } else if (n.type == CALL) {
        r = execute(n[0], x);
        a = execute(n[1], x);
        f = getValue(r);
        if (isPrimitive(f) || typeof f.__call__ != "function") {
            throw new TypeError(r + " is not callable",
                n[0].filename, n[0].lineno);
        }
        t = (r instanceof Reference) ? r.base : null;
        if (t instanceof Activation)
            t = null;
        v = f.__call__(t, a, x);
    } else if (n.type == NEW || n.type == NEW_WITH_ARGS) {
        r = execute(n[0], x);
        f = getValue(r);
        if (n.type == NEW) {
            a = {};
            a.__defineProperty__('length', 0, false, false, true);
        } else {
            a = execute(n[1], x);
        }
        if (isPrimitive(f) || typeof f.__construct__ != "function") {
            throw new TypeError(r + " is not a constructor",
                n[0].filename, n[0].lineno);
        }
        v = f.__construct__(a, x);
    } else if (n.type == ARRAY_INIT) {
        v = [];
        for (i = 0, j = n.length; i < j; i++) {
            if (n[i])
                v[i] = getValue(execute(n[i], x));
        }
        v.length = j;
    } else if (n.type == OBJECT_INIT) {
        v = {};
        for (i = 0, j = n.length; i < j; i++) {
            t = n[i];
            if (t.type == PROPERTY_INIT) {
                v[t[0].value] = getValue(execute(t[1], x));
            } else {
                f = new FunctionObject(t, x.scope);
                u = (t.type == GETTER) ? '__defineGetter__'
                    : '__defineSetter__';
                v[u](t.name, thunk(f, x));
            }
        }
    } else if (n.type == NULL) {
        v = null;
    } else if (n.type == THIS) {
        v = x.thisObject;
    } else if (n.type == TRUE) {
        v = true;
    } else if (n.type == FALSE) {
        v = false;
    } else if (n.type == IDENTIFIER) {
        for (s = x.scope; s; s = s.parent) {
            if (n.value in s.object)
                break;
        }

        v = new Reference(s && s.object, n.value, n);
        // print('find ', n.value, ' in ', s.object);
    } else if (n.type == NUMBER || n.type == STRING || n.type == REGEXP) {
        v = n.value;
    } else if (n.type == GROUP) {
        v = execute(n[0], x);
    } else {
        throw "PANIC: unknown operation " + n.type + ": " + uneval(n);
    }

    return v;
}

function Activation(f, a) {
    for (var i = 0, j = f.params.length; i < j; i++)
        this.__defineProperty__(f.params[i], a[i], true);
    this.__defineProperty__('arguments', a, true);
}

// Null Activation.prototype's proto slot so that Object.prototype.* does not
// pollute the scope of heavyweight functions.  Also delete its 'constructor'
// property so that it doesn't pollute function scopes.  But first, we must
// copy __defineProperty__ down from Object.prototype.

Activation.prototype.__defineProperty__ = Object.prototype.__defineProperty__;
Activation.prototype.__proto__ = null;
delete Activation.prototype.constructor;

function FunctionObject(node, scope) {
    this.node = node;
    this.scope = scope;
    this.__defineProperty__('length', node.params.length, true, true, true);
    var proto = {};
    this.__defineProperty__('prototype', proto, true);
    proto.__defineProperty__('constructor', this, false, false, true);
}

var FOp = FunctionObject.prototype = {
    // Internal methods.
    __call__: function (t, a, x) {
        var x2 = new ExecutionContext(FUNCTION_CODE);
        x2.thisObject = t || global;
        x2.caller = x;
        x2.callee = this;
        a.__defineProperty__('callee', this, false, false, true);
        var f = this.node;
        x2.scope = {object: new Activation(f, a), parent: this.scope};

        ExecutionContext.current = x2;
        try {
            execute(f.body, x2);
        } catch (e) {
            if (e == RETURN) {
                return x2.result;
            } else if (e == THROW) {
                x.result = x2.result;
                throw THROW;
            } else {
                print('throw in __call__: ', e);
            }
        } finally {
            ExecutionContext.current = x;
        }
        return undefined;
    },

    __construct__: function (a, x) {
        var o = new Object;
        var p = this.prototype;
        if (isObject(p))
            o.__proto__ = p;
        // else o.__proto__ defaulted to Object.prototype

        var v = this.__call__(o, a, x);
        if (isObject(v))
            return v;
        return o;
    },

    __hasInstance__: function (v) {
        if (isPrimitive(v))
            return false;
        var p = this.prototype;
        if (isPrimitive(p)) {
            throw new TypeError("'prototype' property is not an object",
                                this.node.filename, this.node.lineno);
        }
        var o;
        while ((o = v.__proto__)) {
            if (o == p)
                return true;
            v = o;
        }
        return false;
    },

    // Standard methods.
    toString: function () {
        return this.node.getSource();
    },

    apply: function (t, a) {
        // Curse ECMA again!
        if (typeof this.__call__ != "function") {
            throw new TypeError("Function.prototype.apply called on" +
                                " uncallable object");
        }

        if (t === undefined || t === null)
            t = global;
        else if (typeof t != "object")
            t = toObject(t, t);

        if (a === undefined || a === null) {
            a = {};
            a.__defineProperty__('length', 0, false, false, true);
        } else if (a instanceof Array) {
            var v = {};
            for (var i = 0, j = a.length; i < j; i++)
                v.__defineProperty__(i, a[i], false, false, true);
            v.__defineProperty__('length', i, false, false, true);
            a = v;
        } else if (!(a instanceof Object)) {
            // XXX check for a non-arguments object
            throw new TypeError("Second argument to Function.prototype.apply" +
                                " must be an array or arguments object",
                                this.node.filename, this.node.lineno);
        }

        return this.__call__(t, a, ExecutionContext.current);
    },

    call: function (t) {
        // Curse ECMA a third time!
        var a = Array.prototype.splice.call(arguments, 1);
        return this.apply(t, a);
    }
};

// Connect Function.prototype and Function.prototype.constructor in global.
reflectClass('Function', FOp);

// Help native and host-scripted functions be like FunctionObjects.
var Fp = Function.prototype;
var REp = RegExp.prototype;

if (!('__call__' in Fp)) {
    Fp.__defineProperty__('__call__', function (t, a, x) {
        // Curse ECMA yet again!
        a = Array.prototype.splice.call(a, 0, a.length);
        return this.apply(t, a);
    }, true, true, true);

    REp.__defineProperty__('__call__', function (t, a, x) {
        a = Array.prototype.splice.call(a, 0, a.length);
        return this.exec.apply(this, a);
    }, true, true, true);

    Fp.__defineProperty__('__construct__', function (a, x) {
        a = Array.prototype.splice.call(a, 0, a.length);
        return this.__applyConstructor__(a);
    }, true, true, true);

    // Since we use native functions such as Date along with host ones such
    // as global.eval, we want both to be considered instances of the native
    // Function constructor.
    Fp.__defineProperty__('__hasInstance__', function (v) {
        return v instanceof Function || v instanceof global.Function;
    }, true, true, true);
}

function thunk(f, x) {
    return function () { return f.__call__(this, arguments, x); };
}

function evaluate(s, f, l) {
    if (typeof s != "string")
        return s;

    var x = ExecutionContext.current;
    var x2 = new ExecutionContext(GLOBAL_CODE);
    ExecutionContext.current = x2;
    try {
        execute(parse(s, f, l), x2);
    } catch (e) {
        if (e == THROW) {
            if (x) {
                x.result = x2.result;
                throw THROW;
            }
            throw x2.result;
        } else {
            print(e);
        }
    } finally {
        ExecutionContext.current = x;
    }
    return x2.result;
}
