from garmin_sync.metrics import classify_activity_intensity

def test_classify_activity_by_training_effect():
    act_hard_te = {"aerobicTrainingEffect": 3.0, "averageHeartRate": 130}
    is_hard, tag = classify_activity_intensity(act_hard_te)
    assert is_hard is True
    assert tag == "hard"

    act_easy_te = {"aerobicTrainingEffect": 2.9, "averageHeartRate": 130}
    is_hard_easy, tag_easy = classify_activity_intensity(act_easy_te)
    assert is_hard_easy is False
    assert tag_easy == "moderate/easy"

def test_classify_activity_by_average_hr():
    act_hard_hr = {"aerobicTrainingEffect": 2.0, "averageHeartRate": 145}
    is_hard, tag = classify_activity_intensity(act_hard_hr)
    assert is_hard is True
    assert tag == "hard"

    act_moderate_hr = {"aerobicTrainingEffect": 2.0, "averageHeartRate": 144}
    is_hard_mod, tag_mod = classify_activity_intensity(act_moderate_hr)
    assert is_hard_mod is False
    assert tag_mod == "moderate/easy"
