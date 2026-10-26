package egovframework.example.board.web;

import egovframework.example.board.service.BoardDefaultVO;
import egovframework.example.board.service.BoardVO;
import egovframework.example.board.service.EgovBoardService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.ModelMap;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.support.SessionStatus;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

@Controller
public class EgovBoardController {

    @Resource(name = "boardService")
    private EgovBoardService boardService;

    /**
     * 게시글 목록을 조회한다.
     * @param searchVO 검색 조건
     */
    @RequestMapping(value = "/board/selectBoardList.do")
    public String selectBoardList(@ModelAttribute("searchVO") BoardDefaultVO searchVO, ModelMap model,
                                  HttpServletRequest request) throws Exception {
        model.addAttribute("resultList", boardService.selectBoardList(searchVO));
        return "board/boardList";
    }

    /** 게시글을 등록한다. */
    @RequestMapping(value = "/board/insertBoard.do", method = RequestMethod.POST)
    public String insertBoard(@ModelAttribute("searchVO") BoardDefaultVO searchVO, BoardVO boardVO,
                              BindingResult bindingResult, ModelMap model, SessionStatus status) throws Exception {
        boardService.insertBoard(boardVO);
        status.setComplete();
        return "forward:/board/selectBoardList.do";
    }

    /** 게시글 상세를 조회한다. */
    @RequestMapping("/board/selectBoard.do")
    @ResponseBody
    public BoardVO selectBoard(BoardVO boardVO) throws Exception {
        return boardService.selectBoard(boardVO);
    }
}
