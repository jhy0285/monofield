package egovframework.example.board.service;

import java.io.Serializable;

public class BoardDefaultVO implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 검색조건 */
    private String searchCondition = "";

    /** 검색어 */
    private String searchKeyword = "";

    // 사용여부
    private String useYn = "Y";
}
