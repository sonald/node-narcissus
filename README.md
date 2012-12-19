This is a simple port of original [narcissus][1] from Brendan for nodejs.
I made some fixes to make it run on nodejs.

some modifications to jsexec.js and jsparse.js:

1. original version considers regexp callable, which is not true right now.
1. conditional catch clause is a mozilla extension to JS, not supported by nodejs.
1. add snarf , __defineProperty__ and print implementation. (see app.js)

[1]: http://lxr.mozilla.org/mozilla/source/js/narcissus