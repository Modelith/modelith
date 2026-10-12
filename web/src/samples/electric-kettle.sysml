/*
 * 電気ケトル（湯沸かしと保温）
 * Modelith のサンプルモデル。要求 → 構造 → 制御 → 振る舞い → 検証 を一つのモデルで管理する。
 */
package ElectricKettle {
    private import ISQ::*;
    private import SI::*;
    private import ScalarValues::*;

    // フェーズ管理：要素やパッケージに @Phase を付けて分類する（パッケージに付けると中の要素が継承）
    metadata def Phase { attribute stage : PhaseKind; }
    enum def PhaseKind { enum StakeholderNeeds; enum SystemRequirements; enum Architecture; enum Verification; }

    // ---------------------------------------------------------------
    // 1. 利用者と関心事
    // ---------------------------------------------------------------
    package Users {
        @Phase { stage = PhaseKind::StakeholderNeeds; }
        part def User;
        part def Regulator;

        concern def Convenience {
            doc /* 少ない待ち時間で、飲みたい温度のお湯が手に入ること */
            stakeholder user : User;
        }
        concern def Safety {
            doc /* 空だき・転倒・やけどの危険がないこと */
            stakeholder user : User;
            stakeholder regulator : Regulator;
        }

        requirement def <'N1'> QuickBoilNeed {
            doc /* 朝の支度の間にお湯が沸くこと */
        }
        requirement def <'N2'> KeepWarmNeed {
            doc /* 選んだ温度のお湯をしばらく保てること */
        }
        requirement def <'N3'> SafeUseNeed {
            doc /* うっかり空だきしても危なくないこと */
        }
    }

    // ---------------------------------------------------------------
    // 2. システム要求
    // ---------------------------------------------------------------
    package Requirements {
        @Phase { stage = PhaseKind::SystemRequirements; }
        private import Users::*;
        private import Structure::*;

        requirement def <'K1'> BoilTimeReq {
            doc /* 水 1.0 L を 20 ℃ から 100 ℃ まで 5 分以内に沸かすこと */
            subject kettle : Kettle;
            attribute boilTime : TimeValue;
            attribute maxBoilTime : TimeValue = 300 [s];
            require constraint { boilTime <= maxBoilTime }
        }
        requirement def <'K2'> KeepWarmAccuracyReq {
            doc /* 保温中の水温を設定温度の ±3 ℃ 以内に保つこと */
            subject kettle : Kettle;
            attribute tempError : TemperatureValue;
            require constraint { tempError <= 3 [K] }
        }
        requirement def <'K3'> DryBoilCutoffReq {
            doc /* 空だきを検知したら 10 s 以内にヒーターを切ること */
            subject kettle : Kettle;
            attribute cutoffTime : TimeValue;
            require constraint { cutoffTime <= 10 [s] }
        }

        requirement kettleRequirements {
            subject kettle : Kettle;
            frame concern convenience : Convenience;
            frame concern safety : Safety;
            requirement k1 : BoilTimeReq;
            requirement k2 : KeepWarmAccuracyReq;
            requirement k3 : DryBoilCutoffReq;
        }

        #derivation dependency from BoilTimeReq to QuickBoilNeed;
        #derivation dependency from KeepWarmAccuracyReq to KeepWarmNeed;
        #derivation dependency from DryBoilCutoffReq to SafeUseNeed;
    }

    // ---------------------------------------------------------------
    // 3. 構造
    // ---------------------------------------------------------------
    package Structure {
        @Phase { stage = PhaseKind::Architecture; }
        private import Signals::*;
        private import Physics::*;

        attribute def KettleParams {
            attribute capacity : VolumeValue = 1.0 [L];
            attribute heaterPower : PowerValue = 1250 [W];
            attribute hysteresis : TemperatureValue = 2 [K];
        }

        part def Kettle {
            attribute params : KettleParams;
            part panel : ControlPanel;
            part sensor : TempSensor;
            part controller : HeaterController;
            part heater : Heater;
            part water : WaterVessel;

            interface modeIf : ModeInterface connect panel.modeOut to controller.modeIn;
            interface tempIf : TempInterface connect sensor.tempOut to controller.tempIn;
            interface powerIf : PowerInterface connect controller.powerOut to heater.powerIn;
            flow of Heat from heater.heatOut to water.heatIn;
            flow of Temperature from water.tempOut to sensor.tempIn;
        }

        part def ControlPanel {
            port modeOut : ModePort;
        }
        part def TempSensor {
            port tempIn : ~TempPort;
            port tempOut : TempPort;
        }
        part def HeaterController {
            attribute target : TemperatureValue = 100 [degC];
            port modeIn : ~ModePort;
            port tempIn : ~TempPort;
            port powerOut : PowerPort;
            exhibit state modes : Behavior::KettleStates;
            perform action control : Behavior::ControlStep;
            constraint law : OnOffLaw;
        }
        part def Heater {
            port powerIn : ~PowerPort;
            port heatOut : HeatPort;
        }
        part def WaterVessel {
            doc /* 制御対象：水の温度 */
            port heatIn : ~HeatPort;
            port tempOut : TempPort;
            constraint balance : HeatBalance;
        }
    }

    // ---------------------------------------------------------------
    // 4. 信号とインタフェース
    // ---------------------------------------------------------------
    package Signals {
        @Phase { stage = PhaseKind::Architecture; }
        item def Mode        { attribute target : TemperatureValue; }
        item def Temperature { attribute value : TemperatureValue; }
        item def PowerCmd    { attribute on : Boolean; }
        item def Heat        { attribute power : PowerValue; }

        port def ModePort  { out item mode : Mode; }
        port def TempPort  { out item temp : Temperature; }
        port def PowerPort { out item cmd : PowerCmd; }
        port def HeatPort  { out item heat : Heat; }

        interface def ModeInterface  { end src : ModePort;  end dst : ~ModePort; }
        interface def TempInterface  { end src : TempPort;  end dst : ~TempPort; }
        interface def PowerInterface { end src : PowerPort; end dst : ~PowerPort; }
    }

    // ---------------------------------------------------------------
    // 5. 物理と制御則（制約式）
    // ---------------------------------------------------------------
    package Physics {
        @Phase { stage = PhaseKind::Architecture; }
        constraint def HeatBalance {
            doc /* 水の熱容量 × 温度変化 = 加熱 − 放熱 */
            in c : Real; in mass : MassValue; in dTdt : Real;
            in P : PowerValue; in loss : PowerValue;
            c * mass * dTdt == P - loss
        }
        constraint def OnOffLaw {
            doc /* 設定温度から hysteresis だけ下がったら加熱を再開する */
            in T : TemperatureValue; in target : TemperatureValue;
            in hysteresis : TemperatureValue; in on : Boolean;
            on == (T < target - hysteresis)
        }
    }

    // ---------------------------------------------------------------
    // 6. 振る舞い
    // ---------------------------------------------------------------
    package Behavior {
        @Phase { stage = PhaseKind::Architecture; }
        private import Signals::*;

        state def KettleStates {
            entry; then idle;
            state idle;
            state heating;
            state keepWarm;
            state fault;

            transition idle_to_heat   first idle     accept StartPressed then heating;
            transition heat_to_warm   first heating  accept TargetReached then keepWarm;
            transition warm_to_heat   first keepWarm accept TooCool then heating;
            transition heat_to_fault  first heating  accept DryDetected then fault;
            transition fault_to_idle  first fault    accept Lifted then idle;
        }
        item def StartPressed; item def TargetReached; item def TooCool;
        item def DryDetected;  item def Lifted;

        action def ControlStep {
            doc /* 0.5 s ごとに実行する制御の 1 ステップ */
            in item temp : Temperature; in item mode : Mode;
            out item cmd : PowerCmd;
            action readSensor;
            then action checkDryBoil;
            then action decideHeater;
            then action writeOutput;
        }
    }

    // ---------------------------------------------------------------
    // 7. シナリオ
    // ---------------------------------------------------------------
    package Scenarios {
        @Phase { stage = PhaseKind::Architecture; }
        private import Structure::*;
        private import Signals::*;

        occurrence def BoilAndKeepWarm {
            doc /* 湯沸かしを始め、沸いたら保温に切り替わるまで */
            part user : Users::User;
            part panel : ControlPanel;
            part controller : HeaterController;
            part heater : Heater;
            part sensor : TempSensor;
            message pressStart of Mode from user to panel;
            then message selectMode of Mode from panel to controller;
            then message heatOn of PowerCmd from controller to heater;
            then message reached of Temperature from sensor to controller;
            then message heatOff of PowerCmd from controller to heater;
        }
    }

    // ---------------------------------------------------------------
    // 8. 要求の充足
    // ---------------------------------------------------------------
    package Allocation {
        @Phase { stage = PhaseKind::Architecture; }
        private import Requirements::*;
        private import Structure::*;
        part kettle : Kettle;

        satisfy kettleRequirements.k1 by kettle.heater;
        satisfy kettleRequirements.k2 by kettle.controller;
        satisfy kettleRequirements.k3 by kettle.controller;
    }

    // ---------------------------------------------------------------
    // 9. 解析と検証
    // ---------------------------------------------------------------
    package Verification {
        @Phase { stage = PhaseKind::Verification; }
        private import Requirements::*;
        private import Structure::*;

        analysis def BoilTimeAnalysis {
            doc /* 定格電力と熱損失から沸騰までの時間を求める */
            subject kettle : Kettle;
            in attribute startTemp : TemperatureValue = 20 [degC];
            return attribute boilTime : TimeValue;
        }

        verification def BoilTest {
            subject kettle : Kettle;
            objective { verify kettleRequirements.k1; }
            analysis boil : BoilTimeAnalysis;
            return verdict : VerdictKind;
        }
        verification def KeepWarmTest {
            subject kettle : Kettle;
            objective { verify kettleRequirements.k2; }
            return verdict : VerdictKind;
        }
    }
}

/* @layout {
  "control": {"ControlPanel":[0,40],"HeaterController":[300,40],"Heater":[620,40],"WaterVessel":[940,40],"TempSensor":[620,260],"OnOffLaw":[300,440],"HeatBalance":[940,440],"@pins":{"HeaterController":{"port:modeIn":["l",0.5],"port:tempIn":["b",0.75],"port:powerOut":["r",0.5]},"WaterVessel":{"port:heatIn":["l",0.5],"port:tempOut":["b",0.5]},"TempSensor":{"port:tempIn":["r",0.5],"port:tempOut":["l",0.5]}}},
  "ibd:Kettle": {"u:panel":[0,0],"u:controller":[300,0],"u:heater":[620,0],"u:water":[940,0],"u:sensor":[620,200],"@pins":{"u:controller":{"port:modeIn":["l",0.5],"port:tempIn":["b",0.75],"port:powerOut":["r",0.5]},"u:water":{"port:heatIn":["l",0.5],"port:tempOut":["b",0.5]},"u:sensor":{"port:tempIn":["r",0.5],"port:tempOut":["l",0.5]}}}
} */
