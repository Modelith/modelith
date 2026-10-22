package Vehicle {
    part def Engine {
        port fuelIn : FuelPort;
    }
    port def FuelPort;
    part def Car {
        doc /* 乗用車 */
        part engine : Engine;
    }
}
