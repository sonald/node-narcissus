function Car(age) {
    this.name = 'a';
    print(this.name);

    function firstName() {
        //print(this);
        //print(this.name);
    }

    firstName();
}

//var car = new Car();
var car = Car();
