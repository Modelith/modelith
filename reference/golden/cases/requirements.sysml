package Reqs {
    requirement def <'R1'> SpeedReq {
        doc /* 速度誤差は ±1 km/h 以内 */
        attribute tolerance : Real = 1.0;
    }
    part def Controller;
    satisfy requirement SpeedReq by Controller;
    verification def SpeedTest {
        verify requirement SpeedReq;
    }
}
