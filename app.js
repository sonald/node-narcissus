#!/usr/bin/env node
// origin: http://lxr.mozilla.org/mozilla/source/js/narcissus/
// need to modify jsexec.js:
// conditional catch clause is a mozilla extension to js.
// regex can not by called as function in v8, so change /regex/(input) into /regex/.exec(input)

var fs = require('fs'),
    vm = require('vm'),
    util = require('util');

var runtime = vm.createContext();

function jsload(filename) {
    vm.runInContext(fs.readFileSync(filename, 'utf8'), runtime);
}

runtime.print = function() {
    console.log.apply(console, [].slice.apply(arguments));
};

var s = '' +
        'Object.prototype.__defineProperty__ = function(name, value, enumerable, removable, writable) {' +
        '    Object.defineProperty(this, name, {' +
        '        value: value,' +
        '        writable: writable || false,' +
        '        enumerable: enumerable || false,' +
        '        configurable: removable || false' +
        '    });' +
        '};';

runtime.snarf = function(filename) {
    if (arguments.length > 1) {
        console.log('snarf doest not support options');
    }

    return fs.readFileSync(filename, 'utf8');
};

vm.runInContext(s, runtime);

jsload('./jsdefs.js');
jsload('./jsparse.js');
jsload('./jsexec.js');

function canonicalize(script) {
    return script.replace(/(["'])/g, '\\$&').replace(/\n/g, '\\n');
}

function jseval(s) {
    var script = '(evaluate("' + s + '", "anon.js", 1))';
    var ret = vm.runInContext(script, runtime);
    console.log('jseval: ', ret);
}

function jsLoadAndEval(filename) {
    jseval( canonicalize(fs.readFileSync(filename, 'utf8')) );
}

// remove anonying tokenizer
function sanitizeAST(ast) {
    if (ast && typeof ast == 'object') {
        if ('tokenizer' in ast) {
            ast.tokenizer = {};
        }

        Object.keys(ast).forEach(function(sub) {
            sanitizeAST(ast[sub]);
        })
    }
}

function jsDumpAST(filename) {
    var script = fs.readFileSync(filename, 'utf8');
    script = 'parse("' + canonicalize(script) +  '", "' + filename + '", 1)';
    // script = script.replace(/\n/g, '\\n');
    console.log('script: ', script);
    var ret = vm.runInContext(script, runtime);
    sanitizeAST(ret);
    console.log(util.inspect(ret, false, null));
}
jsDumpAST("test.js");
jsLoadAndEval('test.js');

