from garmin_sync.metrics import classify_activity_intensity

def test_classify_activity_by_training_effect():
    is_hard, tag = classify_activity_intensity(training_effect=3.0, average_hr=130)
    assert is_hard is True
    assert tag == "hard"

    is_hard_easy, tag_easy = classify_activity_intensity(training_effect=2.9, average_hr=130)
    assert is_hard_easy is False
    assert tag_easy == "moderate/easy"

def test_classify_activity_by_average_hr():
    is_hard, tag = classify_activity_intensity(training_effect=2.0, average_hr=145)
    assert is_hard is True
    assert tag == "hard"

    is_hard_mod, tag_mod = classify_activity_intensity(training_effect=2.0, average_hr=144)
    assert is_hard_mod is False
    assert tag_mod == "moderate/easy"
