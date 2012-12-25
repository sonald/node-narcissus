// test hoisting of narciss
function name(init) {
    print("helo");
    //print(init);
    var init = 2;
    //print(init);
}

//print(Object.prototype.toString.call(name));
var name = "time";

//print(name);
try {
    name('Sian');
} catch (e) {
    print('error');
    print(e);
}
print(name);
