node-narcissus
==============

This is a simple port of original [narcissus][1] from Brendan for nodejs.
I made some fixes to make it run on nodejs.

some modifications to jsexec.js and jsparse.js:

1. original version considers regexp callable, which is not true right now.
1. conditional catch clause is a mozilla extension to JS, not supported by nodejs.
1. add snarf , __defineProperty__ and print implementation. (see app.js)

some semantics checking:

1. 'this' value of inner function
1. arguments are live links to function's position args
1. strict mode semantic
1. how hoisting work
1. try-catch & with clause augmenting execution context

[1]: http://lxr.mozilla.org/mozilla/source/js/narcissus
